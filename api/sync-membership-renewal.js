// api/sync-membership-renewal.js - Batch sync all membership renewal data to Notion
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

  try {
    const { token, syncData } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log('🚀 Starting batch sync for token:', token);
    console.log('📊 Sync data received:', {
      hasOrganizationUpdates: !!syncData.organizationUpdates,
      hasContactOperations: !!syncData.contactOperations,
      contactOperationsCount: {
        create: syncData.contactOperations?.create?.length || 0,
        update: syncData.contactOperations?.update?.length || 0,
        delete: syncData.contactOperations?.delete?.length || 0,
        conferenceTeam: syncData.contactOperations?.conferenceTeam?.length || 0
      }
    });

    const syncResults = {
      organization: null,
      contacts: null,
      errors: [],
      startTime: new Date().toISOString(),
      endTime: null
    };

    let hasErrors = false;

    // Step 1: Sync Organization Updates
    if (syncData.organizationUpdates && Object.keys(syncData.organizationUpdates).length > 0) {
      console.log('🏢 Syncing organization updates...');

      try {
        const orgResponse = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/update-organization`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token: token,
            organizationUpdates: syncData.organizationUpdates
          })
        });

        if (orgResponse.ok) {
          const orgResult = await orgResponse.json();
          syncResults.organization = {
            success: true,
            updatedProperties: orgResult.updatedProperties,
            message: orgResult.message
          };
          console.log('✅ Organization sync completed');
        } else {
          const orgError = await orgResponse.json();
          syncResults.organization = {
            success: false,
            error: orgError.error,
            details: orgError.details
          };
          syncResults.errors.push(`Organization update failed: ${orgError.error}`);
          hasErrors = true;
          console.error('❌ Organization sync failed:', orgError);
        }
      } catch (error) {
        syncResults.organization = {
          success: false,
          error: 'Network error during organization sync',
          details: error.message
        };
        syncResults.errors.push(`Organization sync network error: ${error.message}`);
        hasErrors = true;
        console.error('💥 Organization sync network error:', error);
      }
    } else {
      syncResults.organization = { success: true, message: 'No organization updates to sync' };
      console.log('ℹ️ No organization updates to sync');
    }

    // Step 2: Sync Contact Operations
    if (syncData.contactOperations &&
        (syncData.contactOperations.create?.length > 0 ||
         syncData.contactOperations.update?.length > 0 ||
         syncData.contactOperations.delete?.length > 0 ||
         syncData.contactOperations.conferenceTeam?.length > 0)) {

      console.log('👥 Syncing contact operations...');

      try {
        const contactResponse = await fetch(`${req.headers.origin || 'http://localhost:3000'}/api/save-conference-team`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            token: token,
            contactOperations: syncData.contactOperations
          })
        });

        if (contactResponse.ok) {
          const contactResult = await contactResponse.json();
          syncResults.contacts = {
            success: true,
            results: contactResult.results,
            message: contactResult.message
          };

          // Check for individual contact operation errors
          if (contactResult.results.errors && contactResult.results.errors.length > 0) {
            syncResults.errors.push(...contactResult.results.errors);
            hasErrors = true;
            console.warn('⚠️ Contact sync completed with some errors:', contactResult.results.errors);
          } else {
            console.log('✅ Contact sync completed successfully');
          }
        } else {
          const contactError = await contactResponse.json();
          syncResults.contacts = {
            success: false,
            error: contactError.error,
            details: contactError.details
          };
          syncResults.errors.push(`Contact operations failed: ${contactError.error}`);
          hasErrors = true;
          console.error('❌ Contact sync failed:', contactError);
        }
      } catch (error) {
        syncResults.contacts = {
          success: false,
          error: 'Network error during contact sync',
          details: error.message
        };
        syncResults.errors.push(`Contact sync network error: ${error.message}`);
        hasErrors = true;
        console.error('💥 Contact sync network error:', error);
      }
    } else {
      syncResults.contacts = { success: true, message: 'No contact operations to sync' };
      console.log('ℹ️ No contact operations to sync');
    }

    syncResults.endTime = new Date().toISOString();

    // Step 3: Handle success/failure
    if (hasErrors) {
      console.error('❌ Batch sync completed with errors');

      // Send error notification email with data dump
      await sendErrorNotification(token, syncData, syncResults);

      res.status(207).json({ // 207 Multi-Status for partial success
        success: false,
        message: 'Sync completed with errors',
        results: syncResults,
        hasErrors: true,
        errorCount: syncResults.errors.length
      });
    } else {
      console.log('🎉 Batch sync completed successfully!');

      res.status(200).json({
        success: true,
        message: 'All data synchronized successfully',
        results: syncResults,
        hasErrors: false
      });
    }

  } catch (error) {
    console.error('💥 Fatal error in batch sync:', error);

    // Try to send error notification even for fatal errors
    try {
      await sendErrorNotification(req.body?.token, req.body?.syncData, {
        fatal: true,
        error: error.message,
        stack: error.stack
      });
    } catch (emailError) {
      console.error('💥 Failed to send error notification:', emailError);
    }

    res.status(500).json({
      success: false,
      error: 'Fatal error during sync',
      details: error.message
    });
  }
}

// Send error notification email with human-readable data dump
async function sendErrorNotification(token, syncData, syncResults) {
  try {
    console.log('📧 Sending error notification email...');

    // Get current timestamp
    const timestamp = new Date().toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Build human-readable error report
    let emailBody = `MEMBERSHIP RENEWAL SYNC FAILURE\n`;
    emailBody += `========================================\n`;
    emailBody += `Token: ${token || 'Unknown'}\n`;
    emailBody += `Timestamp: ${timestamp}\n`;
    emailBody += `\n`;

    // Organization updates summary
    if (syncData?.organizationUpdates) {
      emailBody += `ORGANIZATION UPDATES ATTEMPTED:\n`;
      emailBody += `------------------------------\n`;

      if (syncData.organizationUpdates.institutionName) {
        emailBody += `• Institution Name: ${syncData.organizationUpdates.institutionName}\n`;
      }
      if (syncData.organizationUpdates.website) {
        emailBody += `• Website: ${syncData.organizationUpdates.website}\n`;
      }
      if (syncData.organizationUpdates.institutionSize) {
        emailBody += `• Institution Size: ${syncData.organizationUpdates.institutionSize}\n`;
      }
      if (syncData.organizationUpdates.address) {
        const addr = syncData.organizationUpdates.address;
        emailBody += `• Address: ${addr.streetAddress || ''}, ${addr.city || ''}, ${addr.province || ''} ${addr.postalCode || ''}\n`;
      }
      emailBody += `\n`;
    }

    // Contact operations summary
    if (syncData?.contactOperations) {
      emailBody += `CONTACT OPERATIONS ATTEMPTED:\n`;
      emailBody += `---------------------------\n`;

      if (syncData.contactOperations.create?.length > 0) {
        emailBody += `New Contacts (${syncData.contactOperations.create.length}):\n`;
        syncData.contactOperations.create.forEach(contact => {
          emailBody += `  - ${contact.name} (${contact.workEmail})\n`;
        });
        emailBody += `\n`;
      }

      if (syncData.contactOperations.update?.length > 0) {
        emailBody += `Updated Contacts (${syncData.contactOperations.update.length}):\n`;
        syncData.contactOperations.update.forEach(contact => {
          emailBody += `  - ${contact.name} (ID: ${contact.originalId})\n`;
        });
        emailBody += `\n`;
      }

      if (syncData.contactOperations.delete?.length > 0) {
        emailBody += `Deleted Contacts (${syncData.contactOperations.delete.length}):\n`;
        syncData.contactOperations.delete.forEach(contactId => {
          emailBody += `  - Contact ID: ${contactId}\n`;
        });
        emailBody += `\n`;
      }

      if (syncData.contactOperations.conferenceTeam?.length > 0) {
        emailBody += `Conference Team Updates (${syncData.contactOperations.conferenceTeam.length}):\n`;
        syncData.contactOperations.conferenceTeam.forEach(member => {
          emailBody += `  - ${member.id}: ${member.attending ? 'ATTENDING' : 'NOT ATTENDING'}, ${member.isPrimary ? 'PRIMARY' : 'SECONDARY'}\n`;
        });
        emailBody += `\n`;
      }
    }

    // Error details
    emailBody += `ERROR DETAILS:\n`;
    emailBody += `------------\n`;
    if (syncResults.errors && syncResults.errors.length > 0) {
      syncResults.errors.forEach((error, index) => {
        emailBody += `${index + 1}. ${error}\n`;
      });
    } else if (syncResults.fatal) {
      emailBody += `FATAL ERROR: ${syncResults.error}\n`;
    }
    emailBody += `\n`;

    // Raw data backup
    emailBody += `RAW DATA BACKUP (for manual recovery):\n`;
    emailBody += `===================================\n`;
    emailBody += JSON.stringify({ token, syncData, syncResults }, null, 2);

    // For now, just log it (we'll implement actual email sending later)
    console.log('📧 ERROR NOTIFICATION EMAIL CONTENT:');
    console.log('=====================================');
    console.log(emailBody);
    console.log('=====================================');

    // TODO: Implement actual email sending here
    // Could use Nodemailer, SendGrid, or similar service

  } catch (error) {
    console.error('💥 Error generating error notification:', error);
  }
}