// api/email-qbo-invoice.js - Send QuickBooks invoice via email
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://membershiprenewal.campusstores.ca');
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

  // QuickBooks Online environment variables
  const qboAccessToken = process.env.QBO_ACCESS_TOKEN;
  const qboCompanyId = process.env.QBO_COMPANY_ID;
  const qboBaseUrl = process.env.QBO_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com';

  if (!qboAccessToken || !qboCompanyId) {
    console.error('❌ Missing QuickBooks Online credentials');
    res.status(500).json({
      error: 'QuickBooks configuration missing',
      message: 'System configuration error. Please contact support for assistance.'
    });
    return;
  }

  try {
    const { invoiceId, customerEmail, organizationName } = req.body;

    if (!invoiceId) {
      res.status(400).json({
        error: 'Missing required data',
        message: 'Invoice ID is required'
      });
      return;
    }

    // For testing: always send to google@campusstores.ca regardless of customer email
    const testEmailAddress = 'google@campusstores.ca';

    console.log('📧 Sending QuickBooks invoice email for:', {
      invoiceId,
      originalCustomerEmail: customerEmail,
      testEmailAddress,
      organizationName
    });

    // QuickBooks API endpoint for sending invoice emails
    const sendEmailUrl = `${qboBaseUrl}/v3/company/${qboCompanyId}/invoice/${invoiceId}/send`;

    console.log('📨 QB Send Email URL:', sendEmailUrl);

    // Send the invoice via QuickBooks API (always to test email for now)
    const sendResponse = await fetch(sendEmailUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${qboAccessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        EmailAddress: testEmailAddress
      })
    });

    console.log('📬 QB Send Response Status:', sendResponse.status);
    console.log('📬 QB Send Response Headers:', Object.fromEntries(sendResponse.headers));

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      console.error('❌ QB Send Error Response:', errorText);

      // Check for common error scenarios
      if (sendResponse.status === 401) {
        throw new Error('QuickBooks authentication failed - tokens may need refresh');
      } else if (sendResponse.status === 404) {
        throw new Error('Invoice not found in QuickBooks');
      } else {
        throw new Error(`QuickBooks API error: ${sendResponse.status} ${sendResponse.statusText}`);
      }
    }

    const sendResult = await sendResponse.text(); // QB send endpoint returns plain text
    console.log('✅ QB Send Result:', sendResult);

    // Success response
    res.status(200).json({
      success: true,
      message: 'Invoice email sent successfully',
      invoiceId: invoiceId,
      emailAddress: testEmailAddress,
      originalCustomerEmail: customerEmail,
      organizationName: organizationName,
      qbResponse: sendResult
    });

  } catch (error) {
    console.error('💥 QuickBooks invoice email failed:', error);

    // Check if it's an auth error and try to refresh tokens
    const isAuthError = error.message?.includes('401') || error.message?.includes('authentication');
    const isNotFoundError = error.message?.includes('404') || error.message?.includes('not found');

    if (isAuthError) {
      console.log('🔄 Token expired, attempting automatic refresh for email...');

      try {
        // Attempt to refresh the access token
        const newTokens = await refreshQuickBooksTokens();

        if (newTokens) {
          console.log('✅ Tokens refreshed successfully, retrying email send...');

          // Retry the email send with new tokens
          const retryResult = await retryEmailSend(req.body, newTokens);

          res.status(200).json(retryResult);
          return;
        }
      } catch (refreshError) {
        console.error('❌ Token refresh failed for email:', refreshError);
      }
    }

    let errorMessage;
    if (isAuthError) {
      errorMessage = 'Authentication error with QuickBooks. Please try again or contact support if the issue persists.';
    } else if (isNotFoundError) {
      errorMessage = 'Invoice not found. Please try creating the invoice again.';
    } else {
      errorMessage = 'Unable to send invoice email at this time. Please try again or contact support if the issue persists.';
    }

    res.status(500).json({
      success: false,
      error: 'QuickBooks invoice email failed',
      message: errorMessage,
      details: error.message,
      isAuthError: isAuthError,
      isNotFoundError: isNotFoundError
    });
  }
}

// Automatically refresh QuickBooks tokens (shared function)
async function refreshQuickBooksTokens() {
  const qboClientId = process.env.QBO_CLIENT_ID;
  const qboClientSecret = process.env.QBO_CLIENT_SECRET;
  const qboRefreshToken = process.env.QBO_REFRESH_TOKEN;

  if (!qboClientId || !qboClientSecret || !qboRefreshToken) {
    console.error('❌ Missing QuickBooks credentials for token refresh');
    return null;
  }

  console.log('🔄 Refreshing QuickBooks access tokens for email...');

  try {
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
      console.error('❌ Token refresh failed:', errorText);
      return null;
    }

    const tokens = await tokenResponse.json();
    console.log('✅ QuickBooks tokens refreshed successfully for email');

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || qboRefreshToken
    };

  } catch (error) {
    console.error('❌ Token refresh error:', error);
    return null;
  }
}

// Retry email send with fresh tokens
async function retryEmailSend(requestBody, newTokens) {
  const { invoiceId, customerEmail, organizationName } = requestBody;

  const qboCompanyId = process.env.QBO_COMPANY_ID;
  const qboBaseUrl = process.env.QBO_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com';

  const testEmailAddress = 'google@campusstores.ca';

  console.log('🔄 Retrying email send with fresh tokens...', {
    invoiceId,
    testEmailAddress
  });

  const sendEmailUrl = `${qboBaseUrl}/v3/company/${qboCompanyId}/invoice/${invoiceId}/send`;

  const sendResponse = await fetch(sendEmailUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${newTokens.accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      EmailAddress: testEmailAddress
    })
  });

  if (!sendResponse.ok) {
    const errorText = await sendResponse.text();
    throw new Error(`QuickBooks API error on retry: ${sendResponse.status} ${sendResponse.statusText}`);
  }

  const sendResult = await sendResponse.text();
  console.log('✅ Email sent successfully on retry:', sendResult);

  return {
    success: true,
    message: 'Invoice email sent successfully (after token refresh)',
    invoiceId: invoiceId,
    emailAddress: testEmailAddress,
    originalCustomerEmail: customerEmail,
    organizationName: organizationName,
    qbResponse: sendResult,
    tokenRefreshed: true
  };
}