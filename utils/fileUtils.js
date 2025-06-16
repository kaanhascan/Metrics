const fs = require('fs');

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

module.exports = {
  readResultsFile,
  writeResultsFile
}; 