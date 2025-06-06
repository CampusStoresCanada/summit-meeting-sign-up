// api/google-auth.js - Initiates the OAuth flow
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { token, formData } = req.body;
    
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    // Store the form data temporarily (we'll need it after OAuth)
    // In production, you'd use Redis or a database, but for now we'll use a simple approach
    const stateData = {
      token,
      formData,
      timestamp: Date.now()
    };
    
    // Base64 encode the state to pass it through OAuth
    const state = Buffer.from(JSON.stringify(stateData)).toString('base64');
    
    // Google OAuth parameters - using environment variables for security
    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/auth');
    googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    googleAuthUrl.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI);
    googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
    googleAuthUrl.searchParams.set('response_type', 'code');
    googleAuthUrl.searchParams.set('access_type', 'offline');
    googleAuthUrl.searchParams.set('state', state);
    
    res.status(200).json({ authUrl: googleAuthUrl.toString() });
    
  } catch (error) {
    console.error('Error initiating Google auth:', error);
    res.status(500).json({ error: 'Failed to initiate authentication' });
  }
}
