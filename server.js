const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = express();

const { readResultsFile, writeResultsFile } = require('./utils/fileUtils');
const { getCpuUsage, getSystemMetrics, checkHttpStatus, calculateMetrics } = require('./utils/metricsUtils');

app.use(express.static(__dirname));
app.use(express.json());

let apiConfig = {
  api1: { name: '', url: '' },
  api2: { name: '', url: '' }
};

let parallelRequests = 5; 

async function makeApiRequests() {
  const currentResults = { api1: [], api2: [] };

  for (const apiKey of ['api1', 'api2']) {
    const api = apiConfig[apiKey];
    if (!api.url) continue;

    
    const requests = Array.from({ length: parallelRequests }, async () => {
      try {
        const start = Date.now();
        let response;
        let status = 0;

        const beforeMetrics = getSystemMetrics();

        const headers = {};
        if (api.url.includes('localhost:8080')) {
          headers['X-Schema'] = 'user1';
        }

        try {
          response = await axios.get(api.url, { headers });
          status = response.status;
        } catch (err) {
          if (err.response) {
            status = err.response.status;
          }
          throw err;
        }

        const afterMetrics = getSystemMetrics();
        const end = Date.now();
        const duration = end - start;

        return {
          name: api.name,
          url: api.url,
          responseTimeMs: response.data?.durationMs || duration,
          jsonSizeKb: response.data?.jsonSizeKb || 0,
          status: status,
          timestamp: new Date().toISOString(),
          systemMetrics: {
            cpuUsage: response.data?.cpuPercent || 0,
            memoryUsageMB: Math.round((response.data?.memoryUsedKb || 0) / 1024),
            recordCount: response.data?.recordCount || 0
          }
        };
      } catch (err) {
        console.error(`Error fetching ${api.url}:`, err.message);

        const errorMetrics = getSystemMetrics();
        const cpuUsagePercent = ((errorMetrics.cpuUsage.total - errorMetrics.cpuUsage.idle) / errorMetrics.cpuUsage.total) * 100;

        return {
          name: api.name,
          url: api.url,
          error: err.message,
          status: err.response ? err.response.status : 0,
          timestamp: new Date().toISOString(),
          systemMetrics: {
            cpuUsage: cpuUsagePercent.toFixed(2),
            memoryUsageMB: Math.round(errorMetrics.memoryUsage.rss / 1024 / 1024),
            freeMemoryPercent: Math.round((errorMetrics.freeMemory / errorMetrics.totalMemory) * 100)
          },
          jsonSizeKb: 0
        };
      }
    });

    
    const results = await Promise.all(requests);
    currentResults[apiKey].push(...results);
  }

  const allResults = readResultsFile();

  for (const apiKey of ['api1', 'api2']) {
    allResults[apiKey].push(...currentResults[apiKey]);
    if (allResults[apiKey].length > 1000) {
      allResults[apiKey] = allResults[apiKey].slice(-1000);
    }
  }

  writeResultsFile(allResults);
}

setInterval(makeApiRequests, 5000);

app.post('/config', (req, res) => {
  try {
    const { api1, api2 } = req.body;
    
    if (!api1 || !api1.url) {
      return res.status(400).json({ 
        success: false, 
        error: 'API 1 must have a name and URL' 
      });
    }

 
    if (!api2 || !api2.url) {
      apiConfig = { 
        api1, 
        api2: { name: '', url: '' } 
      };
    } else {
      apiConfig = { api1, api2 };
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving configuration:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/results', async (req, res) => {
  try {
    const reset = req.query.reset === 'true';
    const allResults = readResultsFile();
    

    if (reset) {
      writeResultsFile({ api1: [], api2: [] });
      const emptyMetrics = {
        successRate: 0,
        avgResponseTime: 0,
        totalRequests: 0,
        timestamps: [],
        responseTimes: [],
        systemMetrics: {
          cpuUsage: 0,
          memoryUsageMB: 0,
          sizeKB: 0
        }
      };

      res.json({
        api1Metrics: emptyMetrics,
        api2Metrics: null,
        combinedMetrics: null
      });
      return;
    }
    
    const api1Metrics = calculateMetrics(allResults, 'api1');
    let api2Metrics = null;
    let combinedMetrics = null;

 
    if (apiConfig.api2.url) {
      api2Metrics = calculateMetrics(allResults, 'api2');
      
 
      combinedMetrics = {
        timestamps: [...new Set([
          ...api1Metrics.timestamps,
          ...api2Metrics.timestamps
        ])].sort(),
        api1ResponseTimes: api1Metrics.responseTimes,
        api2ResponseTimes: api2Metrics.responseTimes
      };
    }

    res.json({
      api1Metrics,
      api2Metrics,
      combinedMetrics
    });
  } catch (error) {
    console.error('Error in /results endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});


app.post('/reset-results', (req, res) => {
  try {
    writeResultsFile({ api1: [], api2: [] });
    res.json({ success: true, message: 'Results file has been reset' });
  } catch (error) {
    console.error('Error resetting results file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  const systemMetrics = getSystemMetrics();
  const healthData = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    metrics: {
      cpuUsage: `${(systemMetrics.cpuUsage.total / 1000).toFixed(2)} ms`,
      memoryUsageMB: `${Math.round(systemMetrics.memoryUsage.rss / 1024 / 1024)} MB`,
      freeMemoryPercent: `${Math.round((systemMetrics.freeMemory / systemMetrics.totalMemory) * 100)}%`,
      uptime: `${Math.round(systemMetrics.uptime)} seconds`
    }
  };
  res.json(healthData);
});

app.post('/parallel-requests', (req, res) => {
  const { count } = req.body;
  if (typeof count === 'number' && count > 0 && count < 100) {
    parallelRequests = count;
    res.json({ success: true, parallelRequests });
  } else {
    res.status(400).json({ success: false, error: 'Geçerli bir sayı giriniz (1-99 arası).' });
  }
});

app.get('/parallel-requests', (req, res) => {
  res.json({ parallelRequests });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard available at http://localhost:${PORT}`);
});