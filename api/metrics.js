// /api/metrics.js

export default async function handler(req, res) {
  try {
    const metrics = {
      uptime: process.uptime(),
      totalRequests: global.totalRequests || 0,
      averageResponseTime: global.avgResponseTime || 0,
      timestamp: new Date().toISOString()
    };

    res.status(200).json({ status: 'ok', metrics });
  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({ error: 'Metrics check failed' });
  }
}