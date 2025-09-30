// api/create-qbo-invoice.js - Create invoice in QuickBooks Online
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

  // QuickBooks Online environment variables
  const qboClientId = process.env.QBO_CLIENT_ID;
  const qboClientSecret = process.env.QBO_CLIENT_SECRET;
  const qboAccessToken = process.env.QBO_ACCESS_TOKEN;
  const qboRefreshToken = process.env.QBO_REFRESH_TOKEN;
  const qboCompanyId = process.env.QBO_COMPANY_ID;
  const qboBaseUrl = process.env.QBO_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com'; // Default to sandbox

  if (!qboAccessToken || !qboCompanyId) {
    console.error('❌ Missing QuickBooks Online credentials');
    res.status(500).json({
      error: 'QuickBooks configuration missing',
      message: 'Steve is an idiot and will be in contact with you momentarily'
    });
    return;
  }

  try {
    const {
      token,
      organizationData,
      invoiceData,
      billingPreferences
    } = req.body;

    if (!token || !organizationData || !invoiceData) {
      res.status(400).json({ error: 'Missing required data' });
      return;
    }

    console.log('💰 Creating QuickBooks invoice for:', organizationData.name);
    console.log('📋 Invoice data:', invoiceData);
    console.log('⚙️ Billing preferences:', billingPreferences);

    // Step 1: Find or create customer in QuickBooks
    const customer = await findOrCreateCustomer(organizationData, {
      accessToken: qboAccessToken,
      companyId: qboCompanyId,
      baseUrl: qboBaseUrl
    });

    console.log('👤 Customer ready:', customer.DisplayName || customer.Name);

    // Step 2: Create invoice based on billing preference
    const invoice = await createInvoice(customer, invoiceData, billingPreferences, {
      accessToken: qboAccessToken,
      companyId: qboCompanyId,
      baseUrl: qboBaseUrl
    });

    console.log('📄 Invoice created:', invoice.DocNumber);

    // Try multiple potential URL formats for QB invoice access
    const baseUrlForUI = qboBaseUrl.includes('sandbox')
      ? 'https://sandbox-quickbooks.api.intuit.com'
      : 'https://quickbooks.api.intuit.com';

    const possibleUrls = [
      `https://c${process.env.QBO_COMPANY_ID}.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`,
      `https://sandbox-qbo.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`,
      `https://qbo.intuit.com/app/invoice?txnId=${invoice.Id}`,
      `${baseUrlForUI.replace('sandbox-quickbooks.api.intuit.com', 'sandbox-qbo.qbo.intuit.com')}/app/invoice?txnId=${invoice.Id}`,
      `${baseUrlForUI.replace('api.intuit.com', 'qbo.intuit.com')}/app/invoice?txnId=${invoice.Id}`,
    ];

    console.log('📧 Sending invoice via email to generate payment link...');

    // Send the invoice via email to generate the payment link
    const emailResult = await sendInvoiceEmail(invoice.Id, organizationData.primaryContact?.workEmail, {
      accessToken: qboAccessToken,
      companyId: qboCompanyId,
      baseUrl: qboBaseUrl
    });

    console.log('🔗 Fetching invoice payment link from QuickBooks...');

    // Get the invoice payment link using the invoiceLink parameter
    const invoicePaymentLink = await getInvoicePaymentLink(invoice.Id, {
      accessToken: qboAccessToken,
      companyId: qboCompanyId,
      baseUrl: qboBaseUrl
    });

    console.log('📋 Generated possible invoice URLs:', possibleUrls);

    res.status(200).json({
      success: true,
      message: 'Invoice created in QuickBooks Online',
      qboInvoiceId: invoice.Id,
      qboInvoiceNumber: invoice.DocNumber,
      qboCustomerId: customer.Id,
      invoiceUrl: invoicePaymentLink, // Only use payment link from QuickBooks
      paymentLink: invoicePaymentLink, // Direct payment link from QuickBooks
      alternativeUrls: invoicePaymentLink ? [] : possibleUrls, // Only show alternatives if no payment link
      debug: {
        invoiceId: invoice.Id,
        companyId: process.env.QBO_COMPANY_ID,
        baseUrl: qboBaseUrl,
        hasPaymentLink: !!invoicePaymentLink
      }
    });

  } catch (error) {
    console.error('💥 QuickBooks invoice creation failed:', error);

    // Check if it's an auth error and try to refresh tokens
    const isAuthError = error.message?.includes('401') || error.message?.includes('Unauthorized');

    if (isAuthError) {
      console.log('🔄 Token expired, attempting automatic refresh...');

      try {
        // Attempt to refresh the access token
        const newTokens = await refreshQuickBooksTokens();

        if (newTokens) {
          console.log('✅ Tokens refreshed successfully, retrying invoice creation...');

          // Retry the invoice creation with new tokens
          const retryResult = await retryInvoiceCreation(req.body, newTokens);

          res.status(200).json(retryResult);
          return;
        }
      } catch (refreshError) {
        console.error('❌ Token refresh failed:', refreshError);
      }
    }

    const errorMessage = isAuthError
      ? 'Steve is an idiot and forgot to refresh the QuickBooks tokens. He will be in contact with you momentarily.'
      : 'Steve is an idiot and broke the QuickBooks integration. He will be in contact with you momentarily.';

    res.status(500).json({
      success: false,
      error: 'QuickBooks invoice creation failed',
      message: errorMessage,
      details: error.message,
      isAuthError: isAuthError
    });
  }
}

// Find existing customer or create new one
async function findOrCreateCustomer(organizationData, qboConfig) {
  const { accessToken, companyId, baseUrl } = qboConfig;

  console.log('🔍 Looking for customer:', organizationData.name);
  console.log('📧 Primary contact email:', organizationData.primaryContact?.workEmail);
  console.log('👥 Organization data:', JSON.stringify(organizationData, null, 2));

  // Search for existing customer by name (use DisplayName field)
  const query = `SELECT * FROM Customer WHERE DisplayName='${organizationData.name.replace(/'/g, "\\'")}' MAXRESULTS 1`;
  const searchUrl = `${baseUrl}/v3/company/${companyId}/query?query=${encodeURIComponent(query)}`;

  console.log('🔍 QBO Search URL:', searchUrl);
  console.log('🔍 Original query:', query);
  console.log('🔍 Company name:', organizationData.name);

  const searchResponse = await fetch(searchUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!searchResponse.ok) {
    const errorText = await searchResponse.text();
    console.error('❌ QBO Search Error Response:', errorText);
    console.error('❌ QBO Search Headers:', Object.fromEntries(searchResponse.headers));
    throw new Error(`Customer search failed: ${searchResponse.status} ${searchResponse.statusText} - ${errorText}`);
  }

  const searchData = await searchResponse.json();

  if (searchData.QueryResponse?.Customer?.length > 0) {
    const existingCustomer = searchData.QueryResponse.Customer[0];
    console.log('👤 Found existing customer:', existingCustomer.DisplayName || existingCustomer.Name);

    // Check if customer data needs updating
    const needsUpdate = checkCustomerNeedsUpdate(existingCustomer, organizationData);
    const hasEmailFromForm = organizationData.primaryContact?.workEmail;

    if (needsUpdate || hasEmailFromForm) {
      console.log('✏️ Updating customer information...', { needsUpdate, hasEmailFromForm });
      return await updateCustomer(existingCustomer, organizationData, qboConfig);
    }

    return existingCustomer;
  }

  // Customer doesn't exist, create new one
  console.log('➕ Creating new customer...');
  return await createCustomer(organizationData, qboConfig);
}

// Check if customer information needs updating
function checkCustomerNeedsUpdate(existingCustomer, organizationData) {
  const existing = {
    email: existingCustomer.PrimaryEmailAddr?.Address || '',
    website: existingCustomer.WebAddr?.URI || '',
    street: existingCustomer.BillAddr?.Line1 || '',
    city: existingCustomer.BillAddr?.City || '',
    province: existingCustomer.BillAddr?.CountrySubDivisionCode || '',
    postalCode: existingCustomer.BillAddr?.PostalCode || ''
  };

  const current = {
    email: organizationData.primaryContact?.workEmail || '',
    website: organizationData.website || '',
    street: organizationData.address?.streetAddress || '',
    city: organizationData.address?.city || '',
    province: organizationData.address?.province || '',
    postalCode: organizationData.address?.postalCode || ''
  };

  // Check if any field is different
  return Object.keys(current).some(key => existing[key] !== current[key]);
}

// Update existing customer
async function updateCustomer(existingCustomer, organizationData, qboConfig) {
  const { accessToken, companyId, baseUrl } = qboConfig;

  console.log('📧 Updating customer email from', existingCustomer.PrimaryEmailAddr?.Address, 'to', organizationData.primaryContact?.workEmail);

  const updateData = {
    ...existingCustomer,
    sparse: true,
    PrimaryEmailAddr: organizationData.primaryContact?.workEmail ? {
      Address: organizationData.primaryContact.workEmail
    } : existingCustomer.PrimaryEmailAddr,
    WebAddr: organizationData.website ? {
      URI: organizationData.website
    } : existingCustomer.WebAddr,
    BillAddr: {
      Line1: organizationData.address?.streetAddress || existingCustomer.BillAddr?.Line1 || '',
      City: organizationData.address?.city || existingCustomer.BillAddr?.City || '',
      CountrySubDivisionCode: organizationData.address?.province || existingCustomer.BillAddr?.CountrySubDivisionCode || '',
      PostalCode: organizationData.address?.postalCode || existingCustomer.BillAddr?.PostalCode || '',
      Country: 'Canada'
    }
  };

  const updateResponse = await fetch(`${baseUrl}/v3/company/${companyId}/customer`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  });

  if (!updateResponse.ok) {
    throw new Error(`Customer update failed: ${updateResponse.status} ${updateResponse.statusText}`);
  }

  const updateResult = await updateResponse.json();
  console.log('✅ Customer updated:', JSON.stringify(updateResult, null, 2));

  // For update operations, the response structure is different
  if (updateResult.QueryResponse?.Customer?.length > 0) {
    return updateResult.QueryResponse.Customer[0];
  } else if (updateResult.Customer) {
    return updateResult.Customer;
  } else {
    console.error('❌ Unexpected update response structure:', updateResult);
    throw new Error('Customer update response structure is unexpected');
  }
}

// Create new customer
async function createCustomer(organizationData, qboConfig) {
  const { accessToken, companyId, baseUrl } = qboConfig;

  const customerData = {
    DisplayName: organizationData.name,
    CompanyName: organizationData.name,
    PrimaryEmailAddr: organizationData.primaryContact?.workEmail ? {
      Address: organizationData.primaryContact.workEmail
    } : undefined,
    WebAddr: organizationData.website ? {
      URI: organizationData.website
    } : undefined,
    BillAddr: {
      Line1: organizationData.address?.streetAddress || '',
      City: organizationData.address?.city || '',
      CountrySubDivisionCode: organizationData.address?.province || '',
      PostalCode: organizationData.address?.postalCode || '',
      Country: 'Canada'
    }
  };

  const createResponse = await fetch(`${baseUrl}/v3/company/${companyId}/customer`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(customerData)
  });

  if (!createResponse.ok) {
    throw new Error(`Customer creation failed: ${createResponse.status} ${createResponse.statusText}`);
  }

  const createResult = await createResponse.json();
  console.log('✅ Customer created:', JSON.stringify(createResult, null, 2));

  // For create operations, the response structure is different
  if (createResult.QueryResponse?.Customer?.length > 0) {
    return createResult.QueryResponse.Customer[0];
  } else if (createResult.Customer) {
    return createResult.Customer;
  } else {
    console.error('❌ Unexpected create response structure:', createResult);
    throw new Error('Customer create response structure is unexpected');
  }
}

// Create invoice with proper line items based on billing preference
async function createInvoice(customer, invoiceData, billingPreferences, qboConfig) {
  const { accessToken, companyId, baseUrl } = qboConfig;

  const lineItems = formatLineItems(invoiceData, billingPreferences);

  const invoicePayload = {
    Line: lineItems,
    CustomerRef: {
      value: customer.Id
    },
    TxnDate: new Date().toISOString().split('T')[0],
    DueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days
    PrivateNote: `CSC Membership Renewal - Generated automatically`,
    CustomerMemo: {
      value: "Thank you for your CSC membership renewal!"
    }
  };

  console.log('📄 Creating invoice with line items:', lineItems.length);

  const invoiceResponse = await fetch(`${baseUrl}/v3/company/${companyId}/invoice`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(invoicePayload)
  });

  if (!invoiceResponse.ok) {
    const errorText = await invoiceResponse.text();
    throw new Error(`Invoice creation failed: ${invoiceResponse.status} ${invoiceResponse.statusText} - ${errorText}`);
  }

  const invoiceResult = await invoiceResponse.json();
  console.log('✅ Invoice created:', JSON.stringify(invoiceResult, null, 2));

  // For invoice create operations, check different possible response structures
  if (invoiceResult.QueryResponse?.Invoice?.length > 0) {
    return invoiceResult.QueryResponse.Invoice[0];
  } else if (invoiceResult.Invoice) {
    return invoiceResult.Invoice;
  } else {
    console.error('❌ Unexpected invoice response structure:', invoiceResult);
    throw new Error('Invoice create response structure is unexpected');
  }
}

// Format line items based on billing display preference
function formatLineItems(invoiceData, billingPreferences) {
  const lines = [];
  const { membershipFee, conferenceTotal, conferenceHST, billingDisplay } = invoiceData;

  if (billingDisplay === 'single-item') {
    // Single line item with total using the exact service item from QBO
    lines.push({
      Amount: membershipFee + conferenceTotal + conferenceHST,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: {
          value: "19", // CSC Membership & Conference (ID: 19)
          name: "CSC Membership & Conference"
        },
        Qty: 1,
        UnitPrice: membershipFee + conferenceTotal + conferenceHST
      }
    });
  } else if (billingDisplay === 'membership-conference') {
    // Membership line
    lines.push({
      Amount: membershipFee,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: {
          value: "20", // CSC Service (ID: 20)
          name: "CSC Membership"
        },
        Qty: 1,
        UnitPrice: membershipFee
      }
    });

    // Conference line (with HST included in description)
    lines.push({
      Amount: conferenceTotal + conferenceHST,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: {
          value: "20", // CSC Service (ID: 20)
          name: "Conference Registration"
        },
        Qty: 1,
        UnitPrice: conferenceTotal + conferenceHST
      }
    });
  } else {
    // Individual line items - use CSC Service for all
    lines.push({
      Amount: membershipFee,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: {
          value: "20", // CSC Service (ID: 20)
          name: "CSC Membership"
        },
        Qty: 1,
        UnitPrice: membershipFee
      }
    });

    lines.push({
      Amount: conferenceTotal,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: {
          value: "20", // CSC Service (ID: 20)
          name: "Conference Registration"
        },
        Qty: invoiceData.attendingCount || 1,
        UnitPrice: conferenceTotal / (invoiceData.attendingCount || 1)
      }
    });

    if (conferenceHST > 0) {
      lines.push({
        Amount: conferenceHST,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: {
            value: "20", // CSC Service (ID: 20)
            name: "HST (13%)"
          },
          Qty: 1,
          UnitPrice: conferenceHST
        }
      });
    }
  }

  return lines;
}

// Automatically refresh QuickBooks tokens
async function refreshQuickBooksTokens() {
  const qboClientId = process.env.QBO_CLIENT_ID;
  const qboClientSecret = process.env.QBO_CLIENT_SECRET;
  const qboRefreshToken = process.env.QBO_REFRESH_TOKEN;

  if (!qboClientId || !qboClientSecret || !qboRefreshToken) {
    console.error('❌ Missing QuickBooks credentials for token refresh:', {
      clientId: qboClientId ? 'SET' : 'MISSING',
      clientSecret: qboClientSecret ? 'SET' : 'MISSING',
      refreshToken: qboRefreshToken ? 'SET' : 'MISSING'
    });
    return null;
  }

  console.log('🔄 Refreshing QuickBooks access tokens...');

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
    console.log('✅ QuickBooks tokens refreshed successfully');

    // Note: In production, you'd want to update these in your environment variables
    // For now, we'll return them to use for the current request
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || qboRefreshToken
    };

  } catch (error) {
    console.error('❌ Token refresh error:', error);
    return null;
  }
}

// Retry invoice creation with fresh tokens
async function retryInvoiceCreation(requestBody, newTokens) {
  const {
    token,
    organizationData,
    invoiceData,
    billingPreferences
  } = requestBody;

  const qboConfig = {
    accessToken: newTokens.accessToken,
    companyId: process.env.QBO_COMPANY_ID,
    baseUrl: process.env.QBO_BASE_URL || 'https://sandbox-quickbooks.api.intuit.com'
  };

  console.log('🔄 Retrying invoice creation with fresh tokens...');

  // Step 1: Find or create customer
  const customer = await findOrCreateCustomer(organizationData, qboConfig);
  console.log('👤 Customer ready:', customer.DisplayName || customer.Name);

  // Step 2: Create invoice
  const invoice = await createInvoice(customer, invoiceData, billingPreferences, qboConfig);
  console.log('📄 Invoice created on retry:', invoice.DocNumber);

  // Try multiple potential URL formats for QB invoice access
  const baseUrlForUI = qboConfig.baseUrl.includes('sandbox')
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

  const possibleUrls = [
    `https://c${process.env.QBO_COMPANY_ID}.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`,
    `https://sandbox-qbo.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`,
    `https://qbo.intuit.com/app/invoice?txnId=${invoice.Id}`,
    `${baseUrlForUI.replace('sandbox-quickbooks.api.intuit.com', 'sandbox-qbo.qbo.intuit.com')}/app/invoice?txnId=${invoice.Id}`,
    `${baseUrlForUI.replace('api.intuit.com', 'qbo.intuit.com')}/app/invoice?txnId=${invoice.Id}`,
  ];

  // Get the invoice payment link using the invoiceLink parameter
  const invoicePaymentLink = await getInvoicePaymentLink(invoice.Id, {
    accessToken: newTokens.accessToken,
    companyId: process.env.QBO_COMPANY_ID,
    baseUrl: baseUrlForUI
  });

  return {
    success: true,
    message: 'Invoice created in QuickBooks Online (after token refresh)',
    qboInvoiceId: invoice.Id,
    qboInvoiceNumber: invoice.DocNumber,
    qboCustomerId: customer.Id,
    invoiceUrl: invoicePaymentLink, // Only use payment link from QuickBooks
    paymentLink: invoicePaymentLink, // Direct payment link from QuickBooks
    alternativeUrls: invoicePaymentLink ? [] : possibleUrls, // Only show alternatives if no payment link
    tokenRefreshed: true
  };
}

// Get invoice payment link from QuickBooks API
async function getInvoicePaymentLink(invoiceId, qboConfig) {
  const { accessToken, companyId, baseUrl } = qboConfig;

  try {
    console.log('🔗 Requesting invoice payment link for ID:', invoiceId);

    // Make request with include=invoiceLink parameter to get payment link
    const response = await fetch(`${baseUrl}/v3/company/${companyId}/invoice/${invoiceId}?minorversion=65&include=invoiceLink`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('❌ Failed to get invoice payment link:', response.status, response.statusText);
      return null;
    }

    const result = await response.json();
    console.log('📋 Full QB payment link response:', JSON.stringify(result, null, 2));

    const invoice = result.QueryResponse?.Invoice?.[0] || result.Invoice;
    console.log('📋 Parsed invoice object:', JSON.stringify(invoice, null, 2));

    if (invoice?.InvoiceLink) {
      console.log('✅ Got invoice payment link:', invoice.InvoiceLink);
      return invoice.InvoiceLink;
    } else {
      console.log('⚠️ No InvoiceLink field found in invoice response');
      console.log('Available invoice fields:', Object.keys(invoice || {}));
      return null;
    }

  } catch (error) {
    console.error('❌ Error fetching invoice payment link:', error);
    return null;
  }
}

// Send invoice via email to generate payment link
async function sendInvoiceEmail(invoiceId, emailAddress, qboConfig) {
  const { accessToken, companyId, baseUrl } = qboConfig;

  if (!emailAddress) {
    console.log('⚠️ No email address provided, skipping invoice email');
    return { success: false, message: 'No email address provided' };
  }

  try {
    console.log('📧 Sending invoice email to:', emailAddress);

    // QuickBooks API endpoint for sending invoice via email
    const sendUrl = `${baseUrl}/v3/company/${companyId}/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(emailAddress)}`;

    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/octet-stream'
      },
      body: null // Empty body required for QB send operation
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to send invoice email:', response.status, response.statusText, errorText);
      return { success: false, message: `Email sending failed: ${response.status} ${response.statusText}` };
    }

    const result = await response.json();
    console.log('✅ Invoice email sent successfully');

    return { success: true, message: 'Invoice email sent successfully', result };

  } catch (error) {
    console.error('❌ Error sending invoice email:', error);
    return { success: false, message: 'Failed to send invoice email', error: error.message };
  }
}