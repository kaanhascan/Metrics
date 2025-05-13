const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = express();

app.use(express.static(__dirname));
app.use(express.json());

let apiConfig = {
  api1: { name: '', url: '' },
  api2: { name: '', url: '' }
};

function readResultsFile() {
  try {
    if (fs.existsSync('results.json')) {
      const data = fs.readFileSync('results.json', 'utf8');
      if (data.trim() === '') {
        return { api1: [], api2: [] };
      }
      const parsedData = JSON.parse(data);
      // Ensure both api1 and api2 arrays exist
      return {
        api1: Array.isArray(parsedData.api1) ? parsedData.api1 : [],
        api2: Array.isArray(parsedData.api2) ? parsedData.api2 : []
      };
    }
    return { api1: [], api2: [] };
  } catch (err) {
    console.error('Error reading results file:', err);
    return { api1: [], api2: [] };
  }
}

function writeResultsFile(data) {
  // Ensure data structure is correct before writing
  const safeData = {
    api1: Array.isArray(data.api1) ? data.api1 : [],
    api2: Array.isArray(data.api2) ? data.api2 : []
  };
  fs.writeFileSync('results.json', JSON.stringify(safeData, null, 2));
}

function getSystemMetrics() {
  return {
    cpuUsage: process.cpuUsage(),
    memoryUsage: process.memoryUsage(),
    freeMemory: os.freemem(),
    totalMemory: os.totalmem(),
    uptime: process.uptime()
  };
}

async function checkHttpStatus(url) {
  try {
    const response = await axios.get(url);
    return response.status;
  } catch (err) {
    if (err.response) {
      return err.response.status;
    }
    return 0;
  }
}

function calculateMetrics(data, apiKey) {
  if (!data || !data[apiKey] || data[apiKey].length === 0) {
    return {
      successRate: 0,
      avgResponseTime: 0,
      totalRequests: 0,
      timestamps: [],
      responseTimes: []
    };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentData = data[apiKey].filter(item => new Date(item.timestamp) > oneHourAgo);

  const totalRequests = recentData.length;
  const successfulRequests = recentData.filter(item => item.status >= 200 && item.status < 400).length;
  const successRate = totalRequests > 0 ? Math.round((successfulRequests / totalRequests) * 100) : 0;

  const responseTimes = recentData.map(item => item.responseTimeMs || 0);
  const avgResponseTime = responseTimes.length > 0 
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) 
    : 0;

  return {
    successRate,
    avgResponseTime,
    totalRequests,
    timestamps: recentData.map(item => item.timestamp),
    responseTimes: responseTimes
  };
}

async function makeApiRequests() {
  const currentResults = { api1: [], api2: [] };
  const systemMetrics = getSystemMetrics();

  for (const apiKey of ['api1', 'api2']) {
    const api = apiConfig[apiKey];
    if (!api.url) continue;

    try {
      const start = Date.now();
      let response;
      let status = 0;


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
      const end = Date.now();
      const duration = end - start;

      const contentLength = response.headers['content-length'];
      const responseSize = response.data ? JSON.stringify(response.data).length : 0;
      const sizeKB = contentLength ? 
          (parseInt(contentLength, 10) / 1024).toFixed(2) : 
          (responseSize / 1024).toFixed(2);

      currentResults[apiKey].push({
        name: api.name,
        url: api.url,
        responseTimeMs: duration,
        sizeKB: sizeKB ? parseFloat(sizeKB) : null,
        status: status,
        timestamp: new Date().toISOString(),
        systemMetrics: {
          cpuUsage: systemMetrics.cpuUsage.user / 1000,
          memoryUsageMB: Math.round(systemMetrics.memoryUsage.rss / 1024 / 1024),
          freeMemoryPercent: Math.round((systemMetrics.freeMemory / systemMetrics.totalMemory) * 100)
        }
      });
    } catch (err) {
      console.error(`Error fetching ${api.url}:`, err.message);
      currentResults[apiKey].push({
        name: api.name,
        url: api.url,
        error: err.message,
        status: err.response ? err.response.status : 0,
        timestamp: new Date().toISOString(),
        systemMetrics: {
          cpuUsage: systemMetrics.cpuUsage.user / 1000,
          memoryUsageMB: Math.round(systemMetrics.memoryUsage.rss / 1024 / 1024),
          freeMemoryPercent: Math.round((systemMetrics.freeMemory / systemMetrics.totalMemory) * 100)
        }
      });
    }
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
    
    if (!api1 || !api2 || !api1.url || !api2.url) {
      return res.status(400).json({ 
        success: false, 
        error: 'Both APIs must have a name and URL' 
      });
    }

    apiConfig = { api1, api2 };
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
    const allResults = readResultsFile();
    
    const api1Metrics = calculateMetrics(allResults, 'api1');
    const api2Metrics = calculateMetrics(allResults, 'api2');

    const combinedMetrics = {
      timestamps: [...new Set([
        ...api1Metrics.timestamps,
        ...api2Metrics.timestamps
      ])].sort(),
      api1ResponseTimes: api1Metrics.responseTimes,
      api2ResponseTimes: api2Metrics.responseTimes
    };

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

app.get('/health', (req, res) => {
  const systemMetrics = getSystemMetrics();
  const healthData = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    metrics: {
      cpuUsage: `${(systemMetrics.cpuUsage.user / 1000).toFixed(2)} ms`,
      memoryUsageMB: `${Math.round(systemMetrics.memoryUsage.rss / 1024 / 1024)} MB`,
      freeMemoryPercent: `${Math.round((systemMetrics.freeMemory / systemMetrics.totalMemory) * 100)}%`,
      uptime: `${Math.round(systemMetrics.uptime)} seconds`
    }
  };
  res.json(healthData);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard available at http://localhost:${PORT}`);
});