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

  const token = req.query.token;
  
  // Mock data that matches what your frontend expects
  const mockVendorData = {
    boothNumber: "501",
    organization: {
      name: "Test Company Inc",
      website: "https://testcompany.com",
      primaryCategory: "Technology & Electronics",
      description: "We make awesome stuff for campus stores"
    },
    contacts: [
      {
        name: "Jane Doe",
        title: "Sales Manager", 
        email: "jane@testcompany.com",
        circle: "@jane"
      }
    ]
  };

  res.status(200).json(mockVendorData);
}
