export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: `Method ${req.method} not allowed, expected GET` });
    return;
  }

  res.status(200).json({ 
    message: "API is working!", 
    method: req.method,
    token: req.query.token 
  });
}
