// api/process-approved-submissions.js - Process approved vendor submissions
export default async function handler(req, res) {
  // Allow CORS for testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const notionToken = process.env.NOTION_TOKEN;
  const submissionsDbId = process.env.NOTION_SUBMISSIONS_DB_ID;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  
  // Safety check
  if (!notionToken || !submissionsDbId || !organizationsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  try {
    console.log('🔄 Starting approved submissions processing...');

    // Step 1: Find all submissions with Status = "Approved"
    const approvedSubmissions = await fetch(`https://api.notion.com/v1/databases/${submissionsDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'Status',
          status: {
            equals: 'Approved'
          }
        }
      })
    });

    if (!approvedSubmissions.ok) {
      throw new Error(`Failed to fetch approved submissions: ${approvedSubmissions.status}`);
    }

    const submissionsData = await approvedSubmissions.json();
    const submissions = submissionsData.results;

    console.log(`📋 Found ${submissions.length} approved submissions to process`);

    if (submissions.length === 0) {
      res.status(200).json({
        success: true,
        message: 'No approved submissions to process',
        processed: 0
      });
      return;
    }

    const results = {
      processed: [],
      errors: []
    };

    // Step 2: Process each approved submission
    for (const submission of submissions) {
      try {
        const token = submission.properties.Token?.title?.[0]?.text?.content;
        
        if (!token) {
          console.error(`❌ No token found for submission ${submission.id}`);
          results.errors.push(`No token found for submission ${submission.id}`);
          continue;
        }

        console.log(`🔄 Processing submission for token: ${token}`);

        // Step 3: Find the matching Organization record
        const orgResponse = await fetch(`https://api.notion.com/v1/databases/${organizationsDbId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            filter: {
              property: 'Token',
              rich_text: {
                equals: token
              }
            }
          })
        });

        if (!orgResponse.ok) {
          throw new Error(`Failed to find organization for token ${token}`);
        }

        const orgData = await orgResponse.json();
        
        if (orgData.results.length === 0) {
          console.error(`❌ No organization found for token: ${token}`);
          results.errors.push(`No organization found for token: ${token}`);
          continue;
        }

        const organization = orgData.results[0];
        console.log(`🏢 Found organization: ${organization.properties.Organization?.title?.[0]?.text?.content}`);

        // Step 4: Prepare the organization update data
        const updateData = {
          properties: {}
        };

        // Company Name
        const companyName = submission.properties['Company Name']?.rich_text?.[0]?.text?.content;
        if (companyName) {
          updateData.properties['Organization'] = {
            title: [{ text: { content: companyName } }]
          };
          console.log(`📝 Updating company name to: ${companyName}`);
        }

        // Primary Category
        const primaryCategory = submission.properties['Primary Category']?.select?.name;
        if (primaryCategory) {
          updateData.properties['Primary Category'] = {
            select: { name: primaryCategory }
          };
          console.log(`📝 Updating category to: ${primaryCategory}`);
        }

        // Website URL
        const websiteUrl = submission.properties['Website URL']?.url;
        if (websiteUrl) {
          updateData.properties['Website'] = {
            url: websiteUrl
          };
          console.log(`📝 Updating website to: ${websiteUrl}`);
        }

        // Company Description
        const companyDescription = submission.properties['Company Description']?.rich_text?.[0]?.text?.content;
        if (companyDescription) {
          updateData.properties['Company Description'] = {
            rich_text: [{ text: { content: companyDescription } }]
          };
          console.log(`📝 Updating description to: ${companyDescription.substring(0, 50)}...`);
        }

        // Highlight Product Name
        const highlightProductName = submission.properties['Highlight Product Name']?.rich_text?.[0]?.text?.content;
        if (highlightProductName) {
          updateData.properties['Highlight Product Name'] = {
            rich_text: [{ text: { content: highlightProductName } }]
          };
          console.log(`📝 Updating highlight product: ${highlightProductName}`);
        }

        // Highlight Product Description
        const highlightProductDescription = submission.properties['Highlight Product Description']?.rich_text?.[0]?.text?.content;
        if (highlightProductDescription) {
          updateData.properties['Highlight Product Description'] = {
            rich_text: [{ text: { content: highlightProductDescription } }]
          };
          console.log(`📝 Updating highlight description: ${highlightProductDescription.substring(0, 50)}...`);
        }

        // Catalogue URL (if uploaded)
        const catalogueUrl = submission.properties['Catalogue URL']?.url;
        if (catalogueUrl) {
          updateData.properties['Catalogue URL'] = {
            url: catalogueUrl
          };
          console.log(`📝 Updating catalogue URL: ${catalogueUrl}`);
        }

        // Step 5: Update the Organization record
        console.log(`📤 Updating organization record...`);
        
        const updateResponse = await fetch(`https://api.notion.com/v1/pages/${organization.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify(updateData)
        });

        if (!updateResponse.ok) {
          const errorData = await updateResponse.json();
          throw new Error(`Failed to update organization: ${errorData.message}`);
        }

        console.log(`✅ Successfully updated organization for token: ${token}`);

        // Step 6: Mark submission as "Processed"
        const markProcessedResponse = await fetch(`https://api.notion.com/v1/pages/${submission.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            properties: {
              'Status': {
                status: { name: 'Processed' }
              },
              'Processed Date': {
                date: { start: new Date().toISOString().split('T')[0] }
              }
            }
          })
        });

        if (!markProcessedResponse.ok) {
          console.error(`⚠️ Failed to mark submission as processed: ${submission.id}`);
        } else {
          console.log(`✅ Marked submission as processed: ${submission.id}`);
        }

        results.processed.push({
          token: token,
          organizationId: organization.id,
          submissionId: submission.id,
          companyName: companyName
        });

      } catch (error) {
        console.error(`💥 Error processing submission:`, error);
        results.errors.push(`Error processing submission: ${error.message}`);
      }
    }

    // Step 7: Return results
    console.log(`🎉 Processing complete! Processed: ${results.processed.length}, Errors: ${results.errors.length}`);

    res.status(200).json({
      success: true,
      message: `Processed ${results.processed.length} approved submissions`,
      processed: results.processed,
      errors: results.errors,
      totalFound: submissions.length
    });

  } catch (error) {
    console.error('💥 Error in approval processor:', error);
    res.status(500).json({ 
      error: 'Failed to process approved submissions', 
      details: error.message 
    });
  }
}
