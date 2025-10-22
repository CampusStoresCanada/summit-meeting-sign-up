// api/get-qbo-invoice-pdf.js - Get QuickBooks invoice PDF
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://membershiprenewal.campusstores.ca');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
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
    const { invoiceId } = req.query;

    if (!invoiceId) {
      res.status(400).json({
        error: 'Missing required data',
        message: 'Invoice ID is required'
      });
      return;
    }

    console.log('📄 Fetching QuickBooks invoice PDF for ID:', invoiceId);

    // QuickBooks API endpoint for getting invoice PDF
    const pdfUrl = `${qboBaseUrl}/v3/company/${qboCompanyId}/invoice/${invoiceId}/pdf`;

    console.log('📋 QB PDF URL:', pdfUrl);

    // Get the invoice PDF from QuickBooks
    const pdfResponse = await fetch(pdfUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${qboAccessToken}`,
        'Accept': 'application/pdf'
      }
    });

    console.log('📄 QB PDF Response Status:', pdfResponse.status);
    console.log('📄 QB PDF Response Headers:', Object.fromEntries(pdfResponse.headers));

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();
      console.error('❌ QB PDF Error Response:', errorText);

      // Check for common error scenarios
      if (pdfResponse.status === 401) {
        throw new Error('QuickBooks authentication failed - tokens may need refresh');
      } else if (pdfResponse.status === 404) {
        throw new Error('Invoice not found in QuickBooks');
      } else {
        throw new Error(`QuickBooks API error: ${pdfResponse.status} ${pdfResponse.statusText}`);
      }
    }

    // Get the PDF as buffer
    const pdfBuffer = await pdfResponse.buffer();
    console.log('✅ QB PDF fetched successfully, size:', pdfBuffer.length, 'bytes');

    // Return the PDF data as base64 for embedding
    const pdfBase64 = pdfBuffer.toString('base64');

    // Success response with PDF data
    res.status(200).json({
      success: true,
      message: 'Invoice PDF fetched successfully',
      invoiceId: invoiceId,
      pdfData: `data:application/pdf;base64,${pdfBase64}`,
      pdfSize: pdfBuffer.length
    });

  } catch (error) {
    console.error('💥 QuickBooks invoice PDF failed:', error);

    // Check if it's an auth error and try to refresh tokens
    const isAuthError = error.message?.includes('401') || error.message?.includes('authentication');
    const isNotFoundError = error.message?.includes('404') || error.message?.includes('not found');

    if (isAuthError) {
      console.log('🔄 Token expired, attempting automatic refresh for PDF...');

      try {
        // Attempt to refresh the access token
        const newTokens = await refreshQuickBooksTokens();

        if (newTokens) {
          console.log('✅ Tokens refreshed successfully, retrying PDF fetch...');

          // Retry the PDF fetch with new tokens
          const retryResult = await retryPDFFetch(req.query, newTokens);

          res.status(200).json(retryResult);
          return;
        }
      } catch (refreshError) {
        console.error('❌ Token refresh failed for PDF:', refreshError);
      }
    }

    let errorMessage;
    if (isAuthError) {
      errorMessage = 'Authentication error with QuickBooks. Please try again or contact support if the issue persists.';
    } else if (isNotFoundError) {
      errorMessage = 'Invoice not found. Please try creating the invoice again.';
    } else {
      errorMessage = 'Unable to retrieve invoice PDF at this time. Please try again or contact support if the issue persists.';
    }

    res.status(500).json({
      success: false,
      error: 'QuickBooks invoice PDF failed',
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

  console.log('🔄 Refreshing QuickBooks access tokens for PDF...');

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
    console.log('✅ QuickBooks tokens refreshed successfully for PDF');

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || qboRefreshToken
    };

  } catch (error) {
    console.error('❌ Token refresh error:', error);
    return null;
  }
}

// Retry PDF fetch with fresh tokens
async function retryPDFFetch(requestQuery, newTokens) {
  const { invoiceId } = requestQuery;

  const qboCompanyId = process.env.QBO_COMPANY_ID;
  const qboBaseUrl = process.env.QBO_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com';

  console.log('🔄 Retrying PDF fetch with fresh tokens...', {
    invoiceId
  });

  const pdfUrl = `${qboBaseUrl}/v3/company/${qboCompanyId}/invoice/${invoiceId}/pdf`;

  const pdfResponse = await fetch(pdfUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${newTokens.accessToken}`,
      'Accept': 'application/pdf'
    }
  });

  if (!pdfResponse.ok) {
    const errorText = await pdfResponse.text();
    throw new Error(`QuickBooks API error on PDF retry: ${pdfResponse.status} ${pdfResponse.statusText}`);
  }

  const pdfBuffer = await pdfResponse.buffer();
  const pdfBase64 = pdfBuffer.toString('base64');

  console.log('✅ PDF fetched successfully on retry, size:', pdfBuffer.length, 'bytes');

  return {
    success: true,
    message: 'Invoice PDF fetched successfully (after token refresh)',
    invoiceId: invoiceId,
    pdfData: `data:application/pdf;base64,${pdfBase64}`,
    pdfSize: pdfBuffer.length,
    tokenRefreshed: true
  };
}