// api/auto-refresh-squarespace-token.js - Automatically refresh Squarespace OAuth token
// This should be called by a Vercel cron job every 30 minutes

export default async function handler(req, res) {
  console.log('🔄 Starting Squarespace token refresh...');

  const clientId = process.env.SQUARESPACE_CLIENT_ID;
  const clientSecret = process.env.SQUARESPACE_CLIENT_SECRET;
  const refreshToken = process.env.SQUARESPACE_REFRESH_TOKEN;
  const vercelToken = process.env.VERCEL_TOKEN;
  const vercelProjectId = process.env.VERCEL_PROJECT_ID;

  if (!clientId || !clientSecret) {
    console.error('❌ Missing Squarespace OAuth credentials');
    res.status(500).json({ error: 'OAuth credentials not configured' });
    return;
  }

  if (!refreshToken) {
    console.error('❌ No refresh token available');
    res.status(500).json({ error: 'Refresh token not found' });
    return;
  }

  if (!vercelToken || !vercelProjectId) {
    console.error('❌ Missing Vercel credentials');
    res.status(500).json({ error: 'Vercel credentials not configured' });
    return;
  }

  try {
    console.log('🔑 Refreshing Squarespace access token...');

    // Request new access token using refresh token
    const tokenResponse = await fetch('https://login.squarespace.com/api/1/login/oauth/provider/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token refresh failed:', tokenResponse.status, errorText);
      res.status(500).json({
        success: false,
        error: 'Token refresh failed',
        details: errorText
      });
      return;
    }

    const tokenData = await tokenResponse.json();

    console.log('✅ New access token received');
    console.log('📝 Token info:', {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in
    });

    // Update Vercel environment variable with new access token
    console.log('🔄 Updating Vercel environment variables...');

    await updateVercelEnvVar(
      'SQUARESPACE_OAUTH_TOKEN',
      tokenData.access_token,
      vercelToken,
      vercelProjectId
    );

    // Update refresh token if a new one was provided
    if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
      console.log('🔄 Updating refresh token...');
      await updateVercelEnvVar(
        'SQUARESPACE_REFRESH_TOKEN',
        tokenData.refresh_token,
        vercelToken,
        vercelProjectId
      );
    }

    console.log('✅ Token refresh complete!');

    res.status(200).json({
      success: true,
      message: 'Squarespace token refreshed successfully',
      expiresIn: tokenData.expires_in,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('💥 Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed',
      details: error.message
    });
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
    // Delete existing variable
    console.log(`📝 Deleting old ${key}...`);

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
