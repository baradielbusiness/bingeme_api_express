// PM2 ecosystem configuration for BingeMe Express API
// This configuration runs the app in cluster mode for multi-core utilization.
// Environment variables should be provided via .env or your process manager.

module.exports = {
  apps: [
    {
      name: 'bingeme-api',
      script: 'src/server.js', // Use server.js to boot Express and HTTP server
      instances: 'max', // Run one instance per CPU core
      exec_mode: 'cluster', // Enable clustering
      watch: false, // Disable in production; enable in dev if needed
      max_memory_restart: '1G', // Restart if memory exceeds 1GB
      time: true, // Include timestamp in PM2 logs
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      merge_logs: true
    }
  ]
};


