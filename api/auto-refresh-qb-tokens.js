// api/auto-refresh-qb-tokens.js - Automatic QuickBooks token refresh with Vercel env updates
export default async function handler(req, res) {
  // Allow both GET (for manual testing) and POST (for cron jobs)
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  console.log('🔄 Starting automatic QuickBooks token refresh...');

  const qboClientId = process.env.QBO_CLIENT_ID;
  const qboClientSecret = process.env.QBO_CLIENT_SECRET;
  const qboRefreshToken = process.env.QBO_REFRESH_TOKEN;
  const vercelToken = process.env.VERCEL_TOKEN; // We'll need this for updating env vars
  const vercelProjectId = process.env.VERCEL_PROJECT_ID; // And this

  if (!qboClientId || !qboClientSecret || !qboRefreshToken) {
    console.error('❌ Missing QuickBooks credentials for token refresh:', {
      clientId: qboClientId ? 'SET' : 'MISSING',
      clientSecret: qboClientSecret ? 'SET' : 'MISSING',
      refreshToken: qboRefreshToken ? 'SET' : 'MISSING'
    });

    res.status(500).json({
      success: false,
      error: 'Missing QuickBooks credentials',
      message: 'Required environment variables are not set'
    });
    return;
  }

  try {
    // Step 1: Refresh the QuickBooks tokens
    console.log('📡 Requesting new tokens from QuickBooks...');

    const credentials = Buffer.from(`${qboClientId}:${qboClientSecret}`).toString('base64');

    const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: qboRefreshToken
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ QuickBooks token refresh failed:', tokenResponse.status, errorText);

      res.status(tokenResponse.status).json({
        success: false,
        error: 'QuickBooks token refresh failed',
        message: tokenResponse.status === 400
          ? 'Refresh token has expired. Manual re-authentication required via qbo-oauth-helper.html'
          : 'QuickBooks token refresh service error',
        details: errorText
      });
      return;
    }

    const tokens = await tokenResponse.json();
    console.log('✅ Got new QuickBooks tokens');

    // Log token info (without exposing actual tokens)
    console.log('🔑 Token details:', {
      access_token_length: tokens.access_token?.length || 0,
      refresh_token_updated: !!(tokens.refresh_token && tokens.refresh_token !== qboRefreshToken),
      expires_in: tokens.expires_in,
      expires_in_hours: Math.floor(tokens.expires_in / 3600)
    });

    // Step 2: Update Vercel environment variables automatically
    let vercelUpdateSuccess = false;
    let vercelUpdateMessage = '';

    if (vercelToken && vercelProjectId) {
      try {
        console.log('🔧 Updating Vercel environment variables...');

        // Update QBO_ACCESS_TOKEN
        const accessTokenUpdate = await updateVercelEnvVar(
          vercelProjectId,
          vercelToken,
          'QBO_ACCESS_TOKEN',
          tokens.access_token
        );

        // Update QBO_REFRESH_TOKEN if we got a new one
        let refreshTokenUpdate = { success: true, message: 'No refresh token update needed' };
        if (tokens.refresh_token && tokens.refresh_token !== qboRefreshToken) {
          refreshTokenUpdate = await updateVercelEnvVar(
            vercelProjectId,
            vercelToken,
            'QBO_REFRESH_TOKEN',
            tokens.refresh_token
          );
        }

        vercelUpdateSuccess = accessTokenUpdate.success && refreshTokenUpdate.success;
        vercelUpdateMessage = `Access Token: ${accessTokenUpdate.message}, Refresh Token: ${refreshTokenUpdate.message}`;

        if (vercelUpdateSuccess) {
          console.log('✅ Vercel environment variables updated automatically');
        } else {
          console.log('⚠️ Partial Vercel update:', vercelUpdateMessage);
        }

      } catch (vercelError) {
        console.error('❌ Vercel update failed:', vercelError);
        vercelUpdateMessage = `Vercel API error: ${vercelError.message}`;
      }
    } else {
      console.log('⚠️ Skipping Vercel env update - VERCEL_TOKEN or VERCEL_PROJECT_ID not set');
      vercelUpdateMessage = 'Vercel credentials not configured for automatic updates';
    }

    // Step 3: Success response
    const response = {
      success: true,
      message: 'QuickBooks tokens refreshed successfully',
      timestamp: new Date().toISOString(),
      expires_in: tokens.expires_in,
      expires_in_hours: Math.floor(tokens.expires_in / 3600),
      next_refresh_recommended: new Date(Date.now() + (tokens.expires_in - 10 * 60) * 1000).toISOString(), // 10 min before expiry
      vercel_update: {
        attempted: !!(vercelToken && vercelProjectId),
        success: vercelUpdateSuccess,
        message: vercelUpdateMessage
      },
      manual_instructions: vercelUpdateSuccess ? null : {
        message: 'Update these in Vercel environment variables manually:',
        QBO_ACCESS_TOKEN: tokens.access_token,
        QBO_REFRESH_TOKEN: tokens.refresh_token || qboRefreshToken
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('❌ Auto refresh failed:', error);

    res.status(500).json({
      success: false,
      error: 'Automatic token refresh failed',
      message: 'Network or processing error during token refresh',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Update a single Vercel environment variable
async function updateVercelEnvVar(projectId, token, key, value) {
  try {
    // First, try to get existing env var to update it
    const listResponse = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!listResponse.ok) {
      throw new Error(`Failed to list env vars: ${listResponse.status}`);
    }

    const envVars = await listResponse.json();
    const existingVar = envVars.envs?.find(env => env.key === key);

    if (existingVar) {
      // Update existing variable
      const updateResponse = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existingVar.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          value: value
        })
      });

      if (updateResponse.ok) {
        return { success: true, message: `${key} updated successfully` };
      } else {
        const errorText = await updateResponse.text();
        throw new Error(`Update failed: ${updateResponse.status} ${errorText}`);
      }
    } else {
      // Create new variable
      const createResponse = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: key,
          value: value,
          type: 'encrypted',
          target: ['production', 'preview', 'development']
        })
      });

      if (createResponse.ok) {
        return { success: true, message: `${key} created successfully` };
      } else {
        const errorText = await createResponse.text();
        throw new Error(`Create failed: ${createResponse.status} ${errorText}`);
      }
    }

  } catch (error) {
    return { success: false, message: `${key} update failed: ${error.message}` };
  }
}