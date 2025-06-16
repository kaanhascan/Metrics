const os = require('os');
const axios = require('axios');

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
      sizeKB: latestData.jsonSizeKb || 0
    }
  };
}

module.exports = {
  getCpuUsage,
  getSystemMetrics,
  checkHttpStatus,
  calculateMetrics
}; 