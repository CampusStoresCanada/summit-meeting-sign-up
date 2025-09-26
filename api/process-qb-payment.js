// api/process-qb-payment.js - Process QuickBooks Payments
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

  // QuickBooks Payments environment variables
  const qbPaymentsBaseUrl = process.env.QBO_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com';
  const qboAccessToken = process.env.QBO_ACCESS_TOKEN;
  const qboCompanyId = process.env.QBO_COMPANY_ID;

  if (!qboAccessToken || !qboCompanyId) {
    console.error('❌ Missing QuickBooks credentials');
    res.status(500).json({
      error: 'QuickBooks configuration missing',
      message: 'Steve is an idiot and will be in contact with you momentarily'
    });
    return;
  }

  try {
    const { paymentData, organizationName, invoiceId, invoiceNumber } = req.body;

    if (!paymentData || !paymentData.amount || !paymentData.card) {
      res.status(400).json({ error: 'Missing required payment data' });
      return;
    }

    console.log('💳 Processing QuickBooks payment for:', organizationName);
    console.log('💰 Amount:', paymentData.amount, paymentData.currency);

    // Step 1: Create a payment token (card tokenization)
    console.log('🔐 Step 1: Creating payment token...');
    const tokenResult = await createPaymentToken(paymentData.card, qboAccessToken);

    if (!tokenResult.success) {
      throw new Error(tokenResult.error);
    }

    // Step 2: Create the charge using the token
    console.log('💰 Step 2: Creating charge...');
    const chargeResult = await createPaymentCharge(
      tokenResult.token,
      paymentData.amount,
      paymentData.currency,
      organizationName,
      invoiceNumber,
      qboAccessToken,
      qboCompanyId,
      qbPaymentsBaseUrl
    );

    if (!chargeResult.success) {
      throw new Error(chargeResult.error);
    }

    console.log('✅ Payment processed successfully:', chargeResult.transactionId);

    // Success response
    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      transactionId: chargeResult.transactionId,
      amount: paymentData.amount,
      currency: paymentData.currency,
      organizationName: organizationName
    });

  } catch (error) {
    console.error('💥 QuickBooks payment processing failed:', error);

    // Check if it's an auth error and try to refresh tokens
    const isAuthError = error.message?.includes('401') || error.message?.includes('authentication');

    if (isAuthError) {
      console.log('🔄 Token expired, attempting automatic refresh for payment...');

      try {
        // Attempt to refresh the access token
        const newTokens = await refreshQuickBooksTokens();

        if (newTokens) {
          console.log('✅ Tokens refreshed successfully, retrying payment...');

          // Retry the payment with new tokens
          const retryResult = await retryPaymentProcessing(req.body, newTokens);

          res.status(200).json(retryResult);
          return;
        }
      } catch (refreshError) {
        console.error('❌ Token refresh failed for payment:', refreshError);
      }
    }

    let errorMessage;
    if (isAuthError) {
      errorMessage = 'Steve is an idiot and forgot to refresh the QuickBooks tokens. He will be in contact with you momentarily.';
    } else {
      errorMessage = 'Steve is an idiot and broke the QuickBooks payment integration. He will be in contact with you momentarily.';
    }

    res.status(500).json({
      success: false,
      error: 'QuickBooks payment failed',
      message: errorMessage,
      details: error.message
    });
  }
}

// Create payment token for card data
async function createPaymentToken(cardData, accessToken) {
  const qbPaymentsBaseUrl = process.env.QBO_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com';

  try {
    const tokenPayload = {
      card: {
        number: cardData.number,
        expMonth: cardData.expMonth,
        expYear: cardData.expiryYear,
        cvc: cardData.cvc,
        name: cardData.name,
        address: cardData.address
      }
    };

    const tokenResponse = await fetch(`${qbPaymentsBaseUrl}/quickbooks/v4/payments/tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(tokenPayload)
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('❌ Token creation failed:', errorText);
      return {
        success: false,
        error: `Token creation failed: ${tokenResponse.status} ${tokenResponse.statusText}`
      };
    }

    const tokenResult = await tokenResponse.json();
    console.log('✅ Payment token created successfully');

    return {
      success: true,
      token: tokenResult.value // The token value to use for charging
    };

  } catch (error) {
    console.error('❌ Token creation error:', error);
    return {
      success: false,
      error: 'Failed to create payment token'
    };
  }
}

// Create payment charge using token
async function createPaymentCharge(token, amount, currency, description, invoiceNumber, accessToken, companyId, baseUrl) {
  try {
    const chargePayload = {
      amount: amount,
      currency: currency,
      token: token,
      context: {
        mobile: false,
        isEcommerce: true
      },
      description: `CSC Membership - ${description}`,
      invoice: invoiceNumber || undefined
    };

    const chargeResponse = await fetch(`${baseUrl}/quickbooks/v4/payments/charges`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(chargePayload)
    });

    if (!chargeResponse.ok) {
      const errorText = await chargeResponse.text();
      console.error('❌ Charge creation failed:', errorText);
      return {
        success: false,
        error: `Charge creation failed: ${chargeResponse.status} ${chargeResponse.statusText}`
      };
    }

    const chargeResult = await chargeResponse.json();
    console.log('✅ Payment charge created successfully');

    return {
      success: true,
      transactionId: chargeResult.id,
      status: chargeResult.status,
      amount: chargeResult.amount,
      currency: chargeResult.currency
    };

  } catch (error) {
    console.error('❌ Charge creation error:', error);
    return {
      success: false,
      error: 'Failed to create payment charge'
    };
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

  console.log('🔄 Refreshing QuickBooks access tokens for payment...');

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
    console.log('✅ QuickBooks tokens refreshed successfully for payment');

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || qboRefreshToken
    };

  } catch (error) {
    console.error('❌ Token refresh error:', error);
    return null;
  }
}

// Retry payment processing with fresh tokens
async function retryPaymentProcessing(requestBody, newTokens) {
  const { paymentData, organizationName, invoiceId, invoiceNumber } = requestBody;

  console.log('🔄 Retrying payment processing with fresh tokens...');

  // Step 1: Create a payment token with new access token
  const tokenResult = await createPaymentToken(paymentData.card, newTokens.accessToken);

  if (!tokenResult.success) {
    throw new Error(tokenResult.error);
  }

  // Step 2: Create the charge using the token with new access token
  const chargeResult = await createPaymentCharge(
    tokenResult.token,
    paymentData.amount,
    paymentData.currency,
    organizationName,
    invoiceNumber,
    newTokens.accessToken,
    process.env.QBO_COMPANY_ID,
    process.env.QBO_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com'
  );

  if (!chargeResult.success) {
    throw new Error(chargeResult.error);
  }

  console.log('✅ Payment processed successfully on retry:', chargeResult.transactionId);

  return {
    success: true,
    message: 'Payment processed successfully (after token refresh)',
    transactionId: chargeResult.transactionId,
    amount: paymentData.amount,
    currency: paymentData.currency,
    organizationName: organizationName,
    tokenRefreshed: true
  };
}