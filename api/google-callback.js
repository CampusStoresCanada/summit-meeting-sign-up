// api/google-callback.js - Fixed to properly map files to Notion columns
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=oauth_denied`);
    }
    
    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=oauth_invalid`);
    }

    // Decode the state to get our form data
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (e) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=state_invalid`);
    }

    console.log('🎯 Processing OAuth callback for token:', stateData.token);

    // Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_REDIRECT_URI
      })
    });

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', await tokenResponse.text());
      return res.redirect(`${process.env.FRONTEND_URL}/?error=token_failed`);
    }

    const tokens = await tokenResponse.json();
    console.log('✅ Got access token!');

    // Now create the vendor submission in Notion
    await createVendorSubmission(stateData.token, stateData.formData, tokens.access_token);
    
    // Redirect back to success page
    res.redirect(`${process.env.FRONTEND_URL}/?success=true`);
    
  } catch (error) {
    console.error('Error in Google callback:', error);
    res.redirect(`${process.env.FRONTEND_URL}/?error=callback_failed`);
  }
}

// Helper function to create vendor submission
async function createVendorSubmission(token, formData, googleAccessToken) {
  const notionToken = process.env.NOTION_TOKEN || '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';
  const submissionsDbId = process.env.NOTION_SUBMISSIONS_DB_ID || '209a69bf0cfd80afa65dcf0575c9224f';
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID || '1f9a69bf0cfd80158cb6f021d5c616cd';
  
  try {
    console.log('🏢 Getting organization info...');
    
    // Get organization info to get booth number and company name
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
          rich_text: { equals: token }
        }
      })
    });

    const orgData = await orgResponse.json();
    if (orgData.results.length === 0) {
      throw new Error('Organization not found');
    }

    const org = orgData.results[0];
    console.log('✅ Organization found!');
    
    // Get booth number using the proven method
    let boothNumber = 'TBD';
    const boothRelationArray = org.properties['26 Booth Number']?.relation;
    
    if (boothRelationArray && boothRelationArray.length > 0) {
      const boothRelation = boothRelationArray[0];
      const boothResponse = await fetch(`https://api.notion.com/v1/pages/${boothRelation.id}`, {
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28'
        }
      });
      
      if (boothResponse.ok) {
        const boothData = await boothResponse.json();
        const titleText = boothData.properties['Booth Number']?.title?.[0]?.text?.content || '';
        const boothMatch = titleText.match(/^(\d{1,3})/);
        boothNumber = boothMatch ? boothMatch[1] : 'TBD';
        console.log(`🎪 Found booth number: ${boothNumber}`);
      }
    }

    // Upload files to Google Drive FIRST
    const fileResults = await uploadFilesToDrive(
      formData.files || [], 
      googleAccessToken, 
      org.properties.Organization?.title?.[0]?.text?.content || 'Unknown Organization'
    );

    console.log('📁 File upload results:', fileResults);

    // Create submission record in Notion
    const submissionData = {
      parent: { database_id: submissionsDbId },
      properties: {
        "Token": {
          title: [{ text: { content: token } }]
        },
        "Booth Number": {
          rich_text: [{ text: { content: boothNumber } }]
        },
        "Submission Date": {
          date: { start: new Date().toISOString().split('T')[0] }
        },
        "Status": {
          status: { name: "Pending Review" }
        }
      }
    };

    // Add form fields if they exist
    if (formData.companyName) {
      submissionData.properties["Company Name"] = {
        rich_text: [{ text: { content: formData.companyName } }]
      };
    }

    if (formData.companyDescription) {
      submissionData.properties["Company Description"] = {
        rich_text: [{ text: { content: formData.companyDescription } }]
      };
    }

    if (formData.primaryCategory) {
      submissionData.properties["Primary Category"] = {
        select: { name: formData.primaryCategory }
      };
    }

    if (formData.websiteUrl) {
      submissionData.properties["Website URL"] = {
        url: formData.websiteUrl
      };
    }

    if (formData.highlightProductName) {
      submissionData.properties["Highlight Product Name"] = {
        rich_text: [{ text: { content: formData.highlightProductName } }]
      };
    }

    if (formData.highlightProductDescription) {
      submissionData.properties["Highlight Product Description"] = {
        rich_text: [{ text: { content: formData.highlightProductDescription } }]
      };
    }

    // 🎯 HERE'S THE MAGIC - Map files to the correct Notion columns!
    if (fileResults.catalogueUrl) {
      submissionData.properties["Catalogue"] = {
        url: fileResults.catalogueUrl
      };
      console.log('📄 Added catalogue URL:', fileResults.catalogueUrl);
    }

    if (fileResults.otherDocsFolder) {
      submissionData.properties["Other Docs"] = {
        url: fileResults.otherDocsFolder
      };
      console.log('📎 Added other docs folder:', fileResults.otherDocsFolder);
    }

    console.log('💾 Creating Notion submission...');
    const submissionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(submissionData)
    });

    if (!submissionResponse.ok) {
      const errorData = await submissionResponse.json();
      console.error('❌ Notion submission failed:', errorData);
      throw new Error(`Notion submission failed: ${submissionResponse.status}`);
    }

    const submission = await submissionResponse.json();
    console.log(`🎉 MACHO MAN SUCCESS! Created submission: ${submission.id}`);
    
    return submission;
    
  } catch (error) {
    console.error('💥 Error creating vendor submission:', error);
    throw error;
  }
}

// 🚀 COMPLETELY REWRITTEN FILE UPLOAD FUNCTION
async function uploadFilesToDrive(files, accessToken, organizationName) {
  console.log(`📂 Starting upload for ${files.length} files for ${organizationName}...`);
  
  let catalogueUrl = null;
  let otherDocsFolder = null;
  const otherDocsFiles = [];
  
  try {
    // Step 1: Create a folder for this organization's files
    const folderMetadata = {
      name: `${organizationName} - CSC 2026 Vendor Materials`,
      mimeType: 'application/vnd.google-apps.folder'
    };

    const folderResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(folderMetadata)
    });

    let folderId = null;
    if (folderResponse.ok) {
      const folderResult = await folderResponse.json();
      folderId = folderResult.id;
      
      // Make folder shareable
      await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone'
        })
      });

      otherDocsFolder = `https://drive.google.com/drive/folders/${folderId}`;
      console.log('📁 Created shared folder:', otherDocsFolder);
    }

    // Step 2: Upload each file
    for (const fileData of files) {
      console.log(`⬆️ Uploading: ${fileData.name}`);
      
      // Determine if this is a catalogue file based on the field name
      const isCatalogueFile = fileData.fieldName === 'catalogFile' || 
                             fileData.name.toLowerCase().includes('catalog') ||
                             fileData.name.toLowerCase().includes('catalogue');
      
      const metadata = {
        name: fileData.name,
        parents: folderId ? [folderId] : undefined
      };

      // Convert base64 back to binary for upload
      const binaryData = atob(fileData.content);
      const bytes = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        bytes[i] = binaryData.charCodeAt(i);
      }

      // Upload file to Google Drive using resumable upload for reliability
      const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'multipart/related; boundary="boundary_marker"'
        },
        body: createMultipartBody(metadata, fileData, 'boundary_marker')
      });
      
      if (uploadResponse.ok) {
        const fileResult = await uploadResponse.json();
        
        // Make file shareable
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileResult.id}/permissions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role: 'reader',
            type: 'anyone'
          })
        });
        
        const fileUrl = `https://drive.google.com/file/d/${fileResult.id}/view`;
        
        if (isCatalogueFile) {
          catalogueUrl = fileUrl;
          console.log(`📄 Catalogue uploaded: ${fileUrl}`);
        } else {
          otherDocsFiles.push({ name: fileData.name, url: fileUrl });
          console.log(`📎 Other doc uploaded: ${fileData.name} -> ${fileUrl}`);
        }
      } else {
        const errorText = await uploadResponse.text();
        console.error(`❌ Failed to upload: ${fileData.name}`, errorText);
      }
    }

    return {
      catalogueUrl,
      otherDocsFolder,
      otherDocsFiles,
      totalFiles: files.length
    };
    
  } catch (error) {
    console.error('💥 Error uploading files to Drive:', error);
    return {
      catalogueUrl: null,
      otherDocsFolder: null,
      otherDocsFiles: [],
      totalFiles: files.length
    };
  }
}

// Helper function to create multipart body for file upload
function createMultipartBody(metadata, fileData, boundary) {
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;
  
  let body = '';
  
  // Add metadata part
  body += delimiter + '\r\n';
  body += 'Content-Type: application/json\r\n\r\n';
  body += JSON.stringify(metadata) + '\r\n';
  
  // Add file content part
  body += delimiter + '\r\n';
  body += `Content-Type: ${fileData.type}\r\n\r\n`;
  
  // Convert base64 back to binary
  const binaryData = atob(fileData.content);
  body += binaryData + '\r\n';
  
  body += closeDelimiter;
  
  return body;
}// api/google-callback.js - Handles OAuth callback and file uploads
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { code, state, error } = req.query;
    
    if (error) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=oauth_denied`);
    }
    
    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=oauth_invalid`);
    }

    // Decode the state to get our form data
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (e) {
      return res.redirect(`${process.env.FRONTEND_URL}/?error=state_invalid`);
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.GOOGLE_REDIRECT_URI
      })
    });

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', await tokenResponse.text());
      return res.redirect(`${process.env.FRONTEND_URL}/?error=token_failed`);
    }

    const tokens = await tokenResponse.json();
    console.log('Got access token!');

    // Now create the vendor submission in Notion
    await createVendorSubmission(stateData.token, stateData.formData, tokens.access_token);
    
    // Redirect back to success page
    res.redirect(`${process.env.FRONTEND_URL}/?success=true`);
    
  } catch (error) {
    console.error('Error in Google callback:', error);
    res.redirect(`${process.env.FRONTEND_URL}/?error=callback_failed`);
  }
}

// Helper function to create vendor submission
async function createVendorSubmission(token, formData, googleAccessToken) {
  const notionToken = process.env.NOTION_TOKEN;
  const submissionsDbId = process.env.NOTION_SUBMISSIONS_DB_ID;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  
  try {
    // First, get organization info to get booth number
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
          rich_text: { equals: token }
        }
      })
    });

    const orgData = await orgResponse.json();
    if (orgData.results.length === 0) {
      throw new Error('Organization not found');
    }

    const org = orgData.results[0];
    
    // Get booth number (using our proven method)
    let boothNumber = 'TBD';
    const boothRelationArray = org.properties['26 Booth Number']?.relation;
    
    if (boothRelationArray && boothRelationArray.length > 0) {
      const boothRelation = boothRelationArray[0];
      const boothResponse = await fetch(`https://api.notion.com/v1/pages/${boothRelation.id}`, {
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28'
        }
      });
      
      if (boothResponse.ok) {
        const boothData = await boothResponse.json();
        const titleText = boothData.properties['Booth Number']?.title?.[0]?.text?.content || '';
        const boothMatch = titleText.match(/^(\d{1,3})/);
        boothNumber = boothMatch ? boothMatch[1] : 'TBD';
      }
    }

    // Create submission record in Notion
    const submissionData = {
      parent: { database_id: submissionsDbId },
      properties: {
        "Token": {
          title: [{ text: { content: token } }]
        },
        "Booth Number": {
          rich_text: [{ text: { content: boothNumber } }]
        },
        "Submission Date": {
          date: { start: new Date().toISOString().split('T')[0] }
        },
        "Status": {
          status: { name: "Pending Review" }
        },
        "Company Name": {
          rich_text: [{ text: { content: formData.companyName || '' } }]
        },
        "Company Description": {
          rich_text: [{ text: { content: formData.companyDescription || '' } }]
        },
        "Primary Category": {
          select: formData.primaryCategory ? { name: formData.primaryCategory } : null
        },
        "Website URL": {
          url: formData.websiteUrl || null
        },
        "Highlight Product Name": {
          rich_text: [{ text: { content: formData.highlightProductName || '' } }]
        },
        "Highlight Product Description": {
          rich_text: [{ text: { content: formData.highlightProductDescription || '' } }]
        }
      }
    };

    // If we have files, upload them to Google Drive and add links
    if (formData.files && formData.files.length > 0) {
      const fileLinks = await uploadFilesToDrive(
        formData.files, 
        googleAccessToken, 
        org.properties.Organization?.title?.[0]?.text?.content
      );
      
      // Add file links to submission
      if (fileLinks.length > 0) {
        submissionData.properties["File Links"] = {
          rich_text: [{ text: { content: fileLinks.join('\n') } }]
        };
      }
    }

    const submissionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(submissionData)
    });

    if (!submissionResponse.ok) {
      throw new Error(`Notion submission failed: ${submissionResponse.status}`);
    }

    console.log('Vendor submission created successfully!');
    
  } catch (error) {
    console.error('Error creating vendor submission:', error);
    throw error;
  }
}

// Helper function to upload files to Google Drive
async function uploadFilesToDrive(files, accessToken, organizationName) {
  const fileLinks = [];
  
  try {
    // TODO: Create a shared folder for CSC vendor profiles if it doesn't exist
    // For now, we'll upload to the root of the user's authorized Drive access
    
    for (const fileData of files) {
      // Create the file metadata
      const metadata = {
        name: `${organizationName} - ${fileData.name}`,
        // TODO: Add to a shared CSC folder
        // parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
      };

      // Upload file to Google Drive
      const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'multipart/related; boundary="boundary_marker"'
        },
        body: createMultipartBody(metadata, fileData, 'boundary_marker')
      });
      
      if (uploadResponse.ok) {
        const fileResult = await uploadResponse.json();
        
        // Make file shareable with anyone with the link
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileResult.id}/permissions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role: 'reader',
            type: 'anyone'
          })
        });
        
        fileLinks.push(`${fileData.name}: https://drive.google.com/file/d/${fileResult.id}/view`);
        console.log(`Uploaded file: ${fileData.name}`);
      } else {
        console.error(`Failed to upload file: ${fileData.name}`, await uploadResponse.text());
      }
    }
  } catch (error) {
    console.error('Error uploading files to Drive:', error);
  }
  
  return fileLinks;
}

// Helper function to create multipart body for file upload
function createMultipartBody(metadata, fileData, boundary) {
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;
  
  let body = '';
  
  // Add metadata part
  body += delimiter + '\r\n';
  body += 'Content-Type: application/json\r\n\r\n';
  body += JSON.stringify(metadata) + '\r\n';
  
  // Add file content part
  body += delimiter + '\r\n';
  body += `Content-Type: ${fileData.type}\r\n\r\n`;
  body += fileData.content + '\r\n';
  
  body += closeDelimiter;
  
  return body;
}
