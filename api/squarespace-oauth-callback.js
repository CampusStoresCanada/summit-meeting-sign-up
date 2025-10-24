// api/squarespace-oauth-callback.js - Handle Squarespace OAuth callback
export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    console.error('❌ OAuth error:', error);
    res.status(400).send(`OAuth error: ${error}`);
    return;
  }

  if (!code) {
    console.error('❌ No authorization code provided');
    res.status(400).send('No authorization code provided');
    return;
  }

  const clientId = process.env.SQUARESPACE_CLIENT_ID;
  const clientSecret = process.env.SQUARESPACE_CLIENT_SECRET;
  const redirectUri = `${req.headers.origin || 'https://membershiprenewal.campusstores.ca'}/api/squarespace-oauth-callback`;

  if (!clientId || !clientSecret) {
    console.error('❌ Missing Squarespace OAuth credentials');
    res.status(500).send('OAuth credentials not configured');
    return;
  }

  try {
    console.log('🔐 Exchanging authorization code for access token...');

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://login.squarespace.com/api/1/login/oauth/provider/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token exchange failed:', tokenResponse.status, errorText);
      res.status(500).send(`Token exchange failed: ${errorText}`);
      return;
    }

    const tokenData = await tokenResponse.json();

    console.log('✅ Access token received');
    console.log('📝 Token info:', {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in
    });

    // Update Vercel environment variables with the new token
    const vercelToken = process.env.VERCEL_TOKEN;
    const vercelProjectId = process.env.VERCEL_PROJECT_ID;

    if (vercelToken && vercelProjectId) {
      console.log('🔄 Updating Vercel environment variables...');

      // Update SQUARESPACE_OAUTH_TOKEN
      await updateVercelEnvVar(
        'SQUARESPACE_OAUTH_TOKEN',
        tokenData.access_token,
        vercelToken,
        vercelProjectId
      );

      // Store refresh token if provided
      if (tokenData.refresh_token) {
        await updateVercelEnvVar(
          'SQUARESPACE_REFRESH_TOKEN',
          tokenData.refresh_token,
          vercelToken,
          vercelProjectId
        );
      }

      console.log('✅ Vercel environment variables updated');
    } else {
      console.warn('⚠️ Vercel credentials not configured, cannot auto-update env vars');
    }

    // Display the tokens to the user
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Squarespace OAuth - Success</title>
        <style>
          body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 { color: #2d7a3e; }
          code {
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
            display: block;
            margin: 10px 0;
            word-break: break-all;
          }
          .success { color: #2d7a3e; font-weight: bold; }
          .warning { color: #d97706; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Squarespace OAuth Connected!</h1>

          ${vercelToken && vercelProjectId ? `
            <p class="success">Your Squarespace access token has been automatically saved to Vercel environment variables.</p>
            <p>The webhook endpoint is now ready to receive order notifications.</p>
          ` : `
            <p class="warning">⚠️ Please manually add these to your Vercel environment variables:</p>

            <h3>SQUARESPACE_OAUTH_TOKEN</h3>
            <code>${tokenData.access_token}</code>

            ${tokenData.refresh_token ? `
              <h3>SQUARESPACE_REFRESH_TOKEN</h3>
              <code>${tokenData.refresh_token}</code>
            ` : ''}
          `}

          <h3>Token expires in: ${tokenData.expires_in ? Math.floor(tokenData.expires_in / 3600) + ' hours' : 'unknown'}</h3>

          <p><strong>Next steps:</strong></p>
          <ol>
            <li>Set up automatic token refresh cron job (if not already configured)</li>
            <li>Run the webhook subscription setup script</li>
            <li>Test with a delegate registration order</li>
          </ol>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('💥 OAuth callback error:', error);
    res.status(500).send(`OAuth error: ${error.message}`);
  }
}

// Update Vercel environment variable
async function updateVercelEnvVar(key, value, vercelToken, vercelProjectId) {
  const vercelTeamId = process.env.VERCEL_TEAM_ID;

  // Build base URL
  let url = `https://api.vercel.com/v10/projects/${vercelProjectId}/env`;
  if (vercelTeamId) {
    url += `?teamId=${vercelTeamId}`;
  }

  // Check if env var exists
  const listResponse = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${vercelToken}`
    }
  });

  if (!listResponse.ok) {
    throw new Error(`Failed to list env vars: ${listResponse.status}`);
  }

  const envVars = await listResponse.json();
  const existingVar = envVars.envs?.find(env => env.key === key);

  if (existingVar) {
    // Update existing variable
    console.log(`📝 Updating existing ${key}...`);

    let deleteUrl = `https://api.vercel.com/v9/projects/${vercelProjectId}/env/${existingVar.id}`;
    if (vercelTeamId) {
      deleteUrl += `?teamId=${vercelTeamId}`;
    }

    await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${vercelToken}`
      }
    });
  }

  // Create new variable
  console.log(`➕ Creating ${key}...`);

  const createResponse = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${vercelToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      key: key,
      value: value,
      type: 'encrypted',
      target: ['production', 'preview', 'development']
    })
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Failed to create env var: ${createResponse.status} ${errorText}`);
  }

  console.log(`✅ ${key} updated successfully`);
}
