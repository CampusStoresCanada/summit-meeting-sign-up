// api/get-upload-token.js - Get temporary Google Drive upload token
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
    const { token, organizationName } = req.body;
    
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log('🎫 Getting upload token for:', organizationName);

    // Get a fresh access token from Google
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'client_credentials',
        scope: 'https://www.googleapis.com/auth/drive.file'
      })
    });

    if (!tokenResponse.ok) {
      // Fallback: Use service account or provide OAuth URL
      console.log('🔐 Need user OAuth, providing auth URL...');
      
      const stateData = {
        token: token,
        action: 'upload_only',
        organizationName: organizationName,
        timestamp: Date.now()
      };
      
      const encodedState = Buffer.from(JSON.stringify(stateData)).toString('base64');
      
      const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
      googleAuthUrl.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI);
      googleAuthUrl.searchParams.set('response_type', 'code');
      googleAuthUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
      googleAuthUrl.searchParams.set('state', encodedState);
      googleAuthUrl.searchParams.set('access_type', 'offline');
      googleAuthUrl.searchParams.set('prompt', 'consent');
      
      res.status(200).json({
        success: true,
        requiresAuth: true,
        authUrl: googleAuthUrl.toString(),
        message: 'Authorization required for file upload'
      });
      return;
    }

    const tokens = await tokenResponse.json();
    
    // Create organization folder first
    const folderMetadata = {
      name: `${organizationName} - CSC 2026 Vendor Materials`,
      mimeType: 'application/vnd.google-apps.folder'
    };

    const folderResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(folderMetadata)
    });

    let folderId = null;
    if (folderResponse.ok) {
      const folderResult = await folderResponse.json();
      folderId = folderResult.id;
      
      // Make folder shareable
      await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone'
        })
      });

      console.log('📁 Created organization folder:', folderId);
    }

    res.status(200).json({
      success: true,
      requiresAuth: false,
      uploadToken: tokens.access_token,
      folderId: folderId,
      folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
      expiresIn: tokens.expires_in || 3600
    });

  } catch (error) {
    console.error('💥 Error getting upload token:', error);
    res.status(500).json({ 
      error: 'Failed to get upload token', 
      details: error.message 
    });
  }
}
