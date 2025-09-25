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

    console.log('👤 Customer ready:', customer.Name);

    // Step 2: Create invoice based on billing preference
    const invoice = await createInvoice(customer, invoiceData, billingPreferences, {
      accessToken: qboAccessToken,
      companyId: qboCompanyId,
      baseUrl: qboBaseUrl
    });

    console.log('📄 Invoice created:', invoice.DocNumber);

    res.status(200).json({
      success: true,
      message: 'Invoice created in QuickBooks Online',
      qboInvoiceId: invoice.Id,
      qboInvoiceNumber: invoice.DocNumber,
      qboCustomerId: customer.Id,
      invoiceUrl: `${qboBaseUrl.replace('api.intuit.com', 'qbo.intuit.com')}/app/invoice?txnId=${invoice.Id}`
    });

  } catch (error) {
    console.error('💥 QuickBooks invoice creation failed:', error);

    // Determine if it's an auth error
    const isAuthError = error.message?.includes('401') || error.message?.includes('Unauthorized');
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

  // Search for existing customer by name
  const query = `SELECT * FROM Customer WHERE Name='${organizationData.name.replace(/'/g, "\\'")}' MAXRESULTS 1`;
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
    console.log('👤 Found existing customer:', existingCustomer.Name);

    // Check if customer data needs updating
    const needsUpdate = checkCustomerNeedsUpdate(existingCustomer, organizationData);

    if (needsUpdate) {
      console.log('✏️ Updating customer information...');
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
  console.log('✅ Customer updated');
  return updateResult.QueryResponse.Customer[0];
}

// Create new customer
async function createCustomer(organizationData, qboConfig) {
  const { accessToken, companyId, baseUrl } = qboConfig;

  const customerData = {
    Name: organizationData.name,
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
  console.log('✅ Customer created');
  return createResult.QueryResponse.Customer[0];
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
  return invoiceResult.QueryResponse.Invoice[0];
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