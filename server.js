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

  const safeData = {
    api1: Array.isArray(data.api1) ? data.api1 : [],
    api2: Array.isArray(data.api2) ? data.api2 : []
  };
  fs.writeFileSync('results.json', JSON.stringify(safeData, null, 2));
}


function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  return {
    idle: totalIdle / cpus.length,
    total: totalTick / cpus.length
  };
}

function getSystemMetrics() {
  const cpuUsage = getCpuUsage();
  return {
    cpuUsage,
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
      responseTimes: [],
      systemMetrics: {
        cpuUsage: 0,
        memoryUsageMB: 0,
        sizeKB: 0
      }
    };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentData = data[apiKey].filter(item => new Date(item.timestamp) > oneHourAgo);
  const latestData = data[apiKey][data[apiKey].length - 1];


  const trendData = data[apiKey].slice(-100);

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
    timestamps: trendData.map(item => item.timestamp),
    responseTimes: trendData.map(item => item.responseTimeMs || 0),
    systemMetrics: {
      ...latestData.systemMetrics,
      sizeKB: latestData.sizeKB || 0
    }
  };
}

async function makeApiRequests() {
  const currentResults = { api1: [], api2: [] };

  for (const apiKey of ['api1', 'api2']) {
    const api = apiConfig[apiKey];
    if (!api.url) continue;

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


      let metrics = {
        cpuUsage: 0,
        memoryUsageMB: 0,
        sizeKB: 0
      };

      if (response.data && api.url.includes('localhost:8080')) {
        metrics = {
          cpuUsage: response.data.cpuPercent || 0,
          memoryUsageMB: Math.round((response.data.memoryUsedKb || 0) / 1024),
          sizeKB: (JSON.stringify(response.data).length / 1024).toFixed(2)
        };
      } else {
        const cpuUsagePercent = ((afterMetrics.cpuUsage.total - afterMetrics.cpuUsage.idle) / afterMetrics.cpuUsage.total) * 100;
        const memoryUsage = afterMetrics.memoryUsage.rss - beforeMetrics.memoryUsage.rss;
        
        metrics = {
          cpuUsage: cpuUsagePercent.toFixed(2),
          memoryUsageMB: Math.round(memoryUsage / 1024 / 1024),
          sizeKB: response.data ? (JSON.stringify(response.data).length / 1024).toFixed(2) : 0
        };
      }

      currentResults[apiKey].push({
        name: api.name,
        url: api.url,
        responseTimeMs: response.data?.durationMs || duration,
        sizeKB: metrics.sizeKB,
        status: status,
        timestamp: new Date().toISOString(),
        systemMetrics: {
          cpuUsage: metrics.cpuUsage,
          memoryUsageMB: metrics.memoryUsageMB,
          recordCount: response.data?.recordCount || 0
        }
      });
    } catch (err) {
      console.error(`Error fetching ${api.url}:`, err.message);

      const errorMetrics = getSystemMetrics();
      const cpuUsagePercent = ((errorMetrics.cpuUsage.total - errorMetrics.cpuUsage.idle) / errorMetrics.cpuUsage.total) * 100;
      
      currentResults[apiKey].push({
        name: api.name,
        url: api.url,
        error: err.message,
        status: err.response ? err.response.status : 0,
        timestamp: new Date().toISOString(),
        systemMetrics: {
          cpuUsage: cpuUsagePercent.toFixed(2),
          memoryUsageMB: Math.round(errorMetrics.memoryUsage.rss / 1024 / 1024),
          freeMemoryPercent: Math.round((errorMetrics.freeMemory / errorMetrics.totalMemory) * 100)
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard available at http://localhost:${PORT}`);
});