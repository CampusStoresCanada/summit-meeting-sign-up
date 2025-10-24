// api/setup-squarespace-webhook.js - One-time setup script to create webhook subscription
// Visit this URL once after OAuth is complete to set up the webhook

export default async function handler(req, res) {
  console.log('🔧 Setting up Squarespace webhook subscription...');

  const oauthToken = process.env.SQUARESPACE_OAUTH_TOKEN;

  if (!oauthToken) {
    console.error('❌ No Squarespace OAuth token found');
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Squarespace Webhook Setup - Error</title>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
          .error { color: #dc3545; background: #f8d7da; padding: 20px; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>❌ OAuth Token Not Found</h1>
          <p>You need to complete the OAuth flow first.</p>
          <p><a href="/api/squarespace-oauth-start">Click here to start OAuth flow</a></p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  try {
    const webhookUrl = `${req.headers.origin || 'https://membershiprenewal.campusstores.ca'}/api/squarespace-delegate-webhook`;

    console.log('📡 Creating webhook subscription for:', webhookUrl);

    // Create webhook subscription
    const response = await fetch('https://api.squarespace.com/1.0/webhook_subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${oauthToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        endpointUrl: webhookUrl,
        topics: ['order.create']
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Webhook subscription failed:', response.status, errorText);

      // Check if webhook already exists
      if (response.status === 409 || errorText.includes('already exists')) {
        res.status(200).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Squarespace Webhook - Already Exists</title>
            <style>
              body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
              .info { color: #0066cc; background: #e6f2ff; padding: 20px; border-radius: 8px; }
            </style>
          </head>
          <body>
            <div class="info">
              <h1>ℹ️ Webhook Already Configured</h1>
              <p>A webhook subscription for this endpoint already exists.</p>
              <p><strong>Endpoint:</strong> ${webhookUrl}</p>
              <p><strong>Topic:</strong> order.create</p>
              <p>Your delegate registration webhook is ready to receive orders!</p>
            </div>
          </body>
          </html>
        `);
        return;
      }

      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Squarespace Webhook Setup - Error</title>
          <style>
            body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
            .error { color: #dc3545; background: #f8d7da; padding: 20px; border-radius: 8px; }
            code { background: #f5f5f5; padding: 10px; display: block; margin: 10px 0; overflow-x: auto; }
          </style>
        </head>
        <body>
          <div class="error">
            <h1>❌ Webhook Setup Failed</h1>
            <p><strong>Status:</strong> ${response.status}</p>
            <p><strong>Error:</strong></p>
            <code>${errorText}</code>
          </div>
        </body>
        </html>
      `);
      return;
    }

    const webhookData = await response.json();

    console.log('✅ Webhook subscription created successfully!');
    console.log('📋 Subscription details:', {
      id: webhookData.id,
      endpointUrl: webhookData.endpointUrl,
      topics: webhookData.topics,
      hasSecret: !!webhookData.secret
    });

    // Store the webhook secret in Vercel env vars
    if (webhookData.secret) {
      const vercelToken = process.env.VERCEL_TOKEN;
      const vercelProjectId = process.env.VERCEL_PROJECT_ID;

      if (vercelToken && vercelProjectId) {
        console.log('🔐 Storing webhook secret in Vercel...');

        try {
          await updateVercelEnvVar(
            'SQUARESPACE_WEBHOOK_SECRET',
            webhookData.secret,
            vercelToken,
            vercelProjectId
          );
          console.log('✅ Webhook secret stored');
        } catch (error) {
          console.error('⚠️ Failed to store webhook secret:', error);
        }
      }
    }

    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Squarespace Webhook - Success</title>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
          .success { color: #2d7a3e; background: #d4edda; padding: 20px; border-radius: 8px; }
          code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
          .details { margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>✅ Webhook Configured Successfully!</h1>
          <p>Your Squarespace webhook is now active and ready to receive delegate registrations.</p>

          <div class="details">
            <h3>Webhook Details:</h3>
            <p><strong>Subscription ID:</strong> <code>${webhookData.id}</code></p>
            <p><strong>Endpoint:</strong> <code>${webhookData.endpointUrl}</code></p>
            <p><strong>Topics:</strong> ${webhookData.topics.join(', ')}</p>
            <p><strong>Created:</strong> ${new Date(webhookData.createdOn).toLocaleString()}</p>
          </div>

          <h3>Next Steps:</h3>
          <ol>
            <li>Test with a conference delegate registration order</li>
            <li>Check Vercel logs to see webhook activity</li>
            <li>Verify contacts appear in Notion with proper tags</li>
          </ol>

          <p>⚠️ <strong>Important:</strong> Squarespace will automatically disable this webhook if it fails too many times. Monitor your Vercel logs for errors.</p>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('💥 Webhook setup error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Squarespace Webhook Setup - Error</title>
        <style>
          body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
          .error { color: #dc3545; background: #f8d7da; padding: 20px; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>❌ Unexpected Error</h1>
          <p>${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
}

// Update Vercel environment variable
async function updateVercelEnvVar(key, value, vercelToken, vercelProjectId) {
  const vercelTeamId = process.env.VERCEL_TEAM_ID;

  let url = `https://api.vercel.com/v10/projects/${vercelProjectId}/env`;
  if (vercelTeamId) {
    url += `?teamId=${vercelTeamId}`;
  }

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
}
