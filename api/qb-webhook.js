// api/qb-webhook.js - Receive QuickBooks webhook notifications for payments
import crypto from 'crypto';

export default async function handler(req, res) {
  // QB webhooks are always POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  console.log('📬 Received QuickBooks webhook');
  console.log('🔍 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('📦 Body:', JSON.stringify(req.body, null, 2));

  try {
    // Verify webhook signature from QuickBooks
    const signature = req.headers['intuit-signature'];
    const webhookToken = process.env.QBO_WEBHOOK_TOKEN; // You'll set this in dashboard

    console.log('🔐 Signature verification:', {
      hasWebhookToken: !!webhookToken,
      hasSignature: !!signature,
      webhookTokenLength: webhookToken?.length || 0
    });

    if (webhookToken && signature) {
      const payload = JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac('sha256', webhookToken)
        .update(payload)
        .digest('base64');

      if (signature !== expectedSignature) {
        console.error('❌ Invalid webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      console.log('✅ Webhook signature verified');
    } else {
      console.warn('⚠️ Webhook signature not configured - skipping verification');
    }

    // Process the webhook payload
    const { eventNotifications } = req.body;

    console.log('📋 Event notifications count:', eventNotifications?.length || 0);

    if (!eventNotifications || eventNotifications.length === 0) {
      console.log('⚠️ No event notifications in webhook');
      res.status(200).json({ received: true, message: 'No events to process' });
      return;
    }

    let processedCount = 0;
    let paymentCount = 0;

    // Process each notification
    for (const notification of eventNotifications) {
      const { realmId, dataChangeEvent } = notification;

      console.log('🔔 Notification:', {
        realmId,
        hasDataChangeEvent: !!dataChangeEvent,
        entityCount: dataChangeEvent?.entities?.length || 0
      });

      if (!dataChangeEvent || !dataChangeEvent.entities) {
        console.log('⚠️ Skipping notification - no entities');
        continue;
      }

      // Look for Payment events
      for (const entity of dataChangeEvent.entities) {
        console.log('📄 Entity:', {
          name: entity.name,
          id: entity.id,
          operation: entity.operation
        });

        if (entity.name === 'Payment') {
          paymentCount++;
          console.log(`💳 Payment event #${paymentCount}: ${entity.operation} - ID: ${entity.id}`);

          // Only process Create and Update operations (not Delete or Void)
          if (entity.operation === 'Create' || entity.operation === 'Update') {
            console.log(`✅ Processing payment ${entity.id}...`);
            await handlePaymentEvent(entity.id, realmId);
            processedCount++;
          } else {
            console.log(`⏭️ Skipping operation: ${entity.operation}`);
          }
        } else {
          console.log(`⏭️ Skipping non-payment entity: ${entity.name}`);
        }
      }
    }

    console.log(`✅ Webhook processing complete: ${processedCount} payments processed out of ${paymentCount} payment events`);

    res.status(200).json({
      received: true,
      processed: true,
      paymentsProcessed: processedCount,
      totalPaymentEvents: paymentCount
    });

  } catch (error) {
    console.error('💥 Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed', details: error.message });
  }
}

// Handle a payment event
async function handlePaymentEvent(paymentId, realmId) {
  console.log(`\n🔧 handlePaymentEvent called with paymentId: ${paymentId}, realmId: ${realmId}`);

  const qboAccessToken = process.env.QBO_ACCESS_TOKEN;
  const qboCompanyId = process.env.QBO_COMPANY_ID;
  const qboBaseUrl = process.env.QBO_BASE_URL || 'https://quickbooks.api.intuit.com';

  console.log('🔑 QB Config:', {
    hasAccessToken: !!qboAccessToken,
    accessTokenLength: qboAccessToken?.length || 0,
    companyId: qboCompanyId,
    baseUrl: qboBaseUrl
  });

  if (!qboAccessToken || !qboCompanyId) {
    console.error('❌ Missing QuickBooks credentials');
    return;
  }

  // Verify realmId matches our company
  console.log('🏢 Company check:', { realmId, expectedCompanyId: qboCompanyId, matches: realmId === qboCompanyId });

  if (realmId !== qboCompanyId) {
    console.warn(`⚠️ Payment for different company: ${realmId} (expected ${qboCompanyId})`);
    return;
  }

  try {
    // Fetch payment details from QuickBooks
    console.log(`📡 Fetching payment details from QuickBooks for ID: ${paymentId}`);

    const paymentResponse = await fetch(
      `${qboBaseUrl}/v3/company/${qboCompanyId}/payment/${paymentId}?minorversion=65`,
      {
        headers: {
          'Authorization': `Bearer ${qboAccessToken}`,
          'Accept': 'application/json'
        }
      }
    );

    if (!paymentResponse.ok) {
      console.error(`❌ Failed to fetch payment: ${paymentResponse.status}`);
      return;
    }

    const paymentData = await paymentResponse.json();
    const payment = paymentData.Payment;

    if (!payment) {
      console.error('❌ No payment data in response');
      return;
    }

    console.log(`💰 Payment details: Amount: $${payment.TotalAmt}, Customer: ${payment.CustomerRef?.value}`);

    // Get linked invoice IDs from the payment
    const linkedInvoices = payment.Line?.filter(line => line.LinkedTxn)
      .flatMap(line => line.LinkedTxn)
      .filter(txn => txn.TxnType === 'Invoice')
      .map(txn => txn.TxnId) || [];

    if (linkedInvoices.length === 0) {
      console.warn('⚠️ Payment has no linked invoices');
      return;
    }

    console.log(`📄 Payment linked to ${linkedInvoices.length} invoice(s):`, linkedInvoices);

    // For each linked invoice, find the organization and add tag
    for (const invoiceId of linkedInvoices) {
      await processInvoicePayment(invoiceId);
    }

  } catch (error) {
    console.error('❌ Error handling payment event:', error);
  }
}

// Process payment for a specific invoice
async function processInvoicePayment(invoiceId) {
  const notionToken = process.env.NOTION_TOKEN;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  const tagSystemDbId = process.env.NOTION_TAG_SYSTEM_DB_ID;

  if (!notionToken || !organizationsDbId || !tagSystemDbId) {
    console.error('❌ Missing Notion credentials');
    return;
  }

  try {
    console.log(`🔍 Looking up organization for invoice ID: ${invoiceId}`);

    // Find organization by QB Invoice ID
    const orgResponse = await fetch(`https://api.notion.com/v1/databases/${organizationsDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'QBO Invoice ID',
          rich_text: {
            equals: invoiceId.toString()
          }
        }
      })
    });

    if (!orgResponse.ok) {
      console.error(`❌ Notion query failed: ${orgResponse.status}`);
      return;
    }

    const orgData = await orgResponse.json();

    if (orgData.results.length === 0) {
      console.warn(`⚠️ No organization found for invoice ID: ${invoiceId}`);
      return;
    }

    const organization = orgData.results[0];
    const orgName = organization.properties.Organization?.title?.[0]?.text?.content || 'Unknown';
    console.log(`🏢 Found organization: ${orgName}`);

    // Check if organization already has the "25/26 Member" tag
    const existingTags = organization.properties.Tag?.relation || [];
    console.log(`🏷️ Organization has ${existingTags.length} existing tags`);

    // Get the "25/26 Member" tag ID
    const memberTagResponse = await fetch(`https://api.notion.com/v1/databases/${tagSystemDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'Name',
          title: {
            equals: '25/26 Member'
          }
        }
      })
    });

    if (!memberTagResponse.ok) {
      console.error(`❌ Failed to fetch member tag: ${memberTagResponse.status}`);
      return;
    }

    const memberTagData = await memberTagResponse.json();

    if (memberTagData.results.length === 0) {
      console.error('❌ "25/26 Member" tag not found in Tag System');
      return;
    }

    const memberTagId = memberTagData.results[0].id;
    console.log(`🏷️ Found "25/26 Member" tag ID: ${memberTagId}`);

    // Check if tag already exists
    const hasTag = existingTags.some(tag => tag.id === memberTagId);

    if (hasTag) {
      console.log(`✅ Organization already has "25/26 Member" tag - skipping`);
      return;
    }

    // Add the tag to the organization
    console.log(`➕ Adding "25/26 Member" tag to ${orgName}...`);

    const updateResponse = await fetch(`https://api.notion.com/v1/pages/${organization.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        properties: {
          'Tag': {
            relation: [
              ...existingTags,
              { id: memberTagId }
            ]
          }
        }
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`❌ Failed to add tag: ${updateResponse.status} ${errorText}`);
      return;
    }

    console.log(`🎉 Successfully added "25/26 Member" tag to ${orgName}!`);

  } catch (error) {
    console.error('❌ Error processing invoice payment:', error);
  }
}
