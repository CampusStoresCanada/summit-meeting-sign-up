// api/save-conference-team.js - Handle all contact operations
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

  const notionToken = process.env.NOTION_TOKEN;
  const organizationsDbId = process.env.NOTION_ORGANIZATIONS_DB_ID;
  const contactsDbId = process.env.NOTION_CONTACTS_DB_ID;
  const tagSystemDbId = process.env.NOTION_TAG_SYSTEM_DB_ID;
  
  // Safety check
  if (!notionToken || !organizationsDbId || !contactsDbId) {
    console.error('❌ Missing environment variables!');
    res.status(500).json({ error: 'Missing configuration' });
    return;
  }

  try {
    const { token, contactOperations } = req.body;
    console.log('🔍 BACKEND DEBUG - Received contactOperations:', JSON.stringify(contactOperations, null, 2));

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    console.log('👥 Processing conference team operations for token:', token);

    // Step 1: Get organization info (we need the org ID for relations)
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
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const org = orgData.results[0];
    const organizationId = org.id;
    const organizationName = org.properties.Organization?.title?.[0]?.text?.content || '';
    
    console.log(`🏢 Found organization: ${organizationName} (${organizationId})`);

    const results = {
      created: [],
      updated: [],
      deleted: [],
      errors: []
    };

    // Step 2: Handle CREATE operations
    if (contactOperations.create && contactOperations.create.length > 0) {
      console.log(`➕ Creating ${contactOperations.create.length} new contacts...`);
      
      for (const newContact of contactOperations.create) {
        try {
          const contactData = {
            parent: { database_id: contactsDbId },
            properties: {
              "Name": {
                title: [{ text: { content: newContact.name || 'Unknown Name' } }]
              },
              "First Name": {
                rich_text: [{ text: { content: newContact.firstName || newContact.name?.split(' ')[0] || '' } }]
              },
              "Work Email": {
                email: newContact.workEmail || null
              },
              "Work Phone Number": {
                phone_number: newContact.workPhone || null
              },
              "Role/Title": {
                rich_text: [{ text: { content: newContact.roleTitle || '' } }]
              },
              "Contact Type": {
                multi_select: [{ name: "Vendor Partner" }]
              },
              "Organization": {
                relation: [{ id: organizationId }]
              },
              "Notes": {
                rich_text: [{ text: { content: "Added during conference registration" } }]
              }
            }
          };

          // Add dietary restrictions if provided
          if (newContact.dietaryRestrictions) {
            contactData.properties["Dietary Restrictions"] = {
              rich_text: [{ text: { content: newContact.dietaryRestrictions } }]
            };
          }

          const createResponse = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify(contactData)
          });

          if (createResponse.ok) {
            const createdContact = await createResponse.json();
            results.created.push({
              id: createdContact.id,
              name: newContact.name
            });
            console.log(`✅ Created contact: ${newContact.name}`);
          } else {
            const errorData = await createResponse.json();
            results.errors.push(`Failed to create ${newContact.name}: ${errorData.message}`);
            console.error(`❌ Failed to create ${newContact.name}:`, errorData);
          }
        } catch (error) {
          results.errors.push(`Error creating ${newContact.name}: ${error.message}`);
          console.error(`💥 Error creating ${newContact.name}:`, error);
        }
      }
    }

    // Step 3: Handle UPDATE operations
    if (contactOperations.update && contactOperations.update.length > 0) {
      console.log(`✏️ Updating ${contactOperations.update.length} contacts...`);
      console.log(`📝 Update data received:`, JSON.stringify(contactOperations.update, null, 2));
      
      for (const updateContact of contactOperations.update) {
        console.log(`🔄 Processing update for originalId: ${updateContact.originalId}`);
        console.log(`📝 New name will be: "${updateContact.name}"`);
        
        try {
          const updateData = {
            properties: {}
          };
    
          // Only include fields that are being updated
          if (updateContact.name) {
            console.log(`📝 Setting Name property to: "${updateContact.name}"`);
            updateData.properties["Name"] = {
              title: [{ text: { content: updateContact.name } }]
            };
          }
              
          if (updateContact.workEmail) {
            updateData.properties["Work Email"] = {
              email: updateContact.workEmail
            };
          }
          
          if (updateContact.workPhone) {
            updateData.properties["Work Phone Number"] = {
              phone_number: updateContact.workPhone
            };
          }
          
          if (updateContact.roleTitle) {
            updateData.properties["Role/Title"] = {
              rich_text: [{ text: { content: updateContact.roleTitle } }]
            };
          }

          if (updateContact.dietaryRestrictions) {
            updateData.properties["Dietary Restrictions"] = {
              rich_text: [{ text: { content: updateContact.dietaryRestrictions } }]
            };
          }

          console.log(`📤 Sending to Notion:`, JSON.stringify(updateData, null, 2));
    
          const updateResponse = await fetch(`https://api.notion.com/v1/pages/${updateContact.originalId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify(updateData)
          });
    
          console.log(`📡 Notion response status: ${updateResponse.status}`);
    
          if (updateResponse.ok) {
            const responseData = await updateResponse.json();
            console.log(`✅ Successfully updated contact: ${updateContact.name}`);
            results.updated.push({
              id: updateContact.originalId,
              name: updateContact.name || 'Contact'
            });
          } else {
            const errorData = await updateResponse.json();
            console.error(`❌ Notion update failed:`, errorData);
            results.errors.push(`Failed to update contact: ${errorData.message}`);
          }
        } catch (error) {
          console.error(`💥 Error updating contact:`, error);
          results.errors.push(`Error updating contact: ${error.message}`);
        }
      }
    } else {
      console.log(`⚠️ No updates to process. contactOperations.update length:`, contactOperations.update?.length || 0);
    }
    // Step 4: Handle DELETE operations (we'll mark as inactive rather than delete)
    if (contactOperations.delete && contactOperations.delete.length > 0) {
      console.log(`🗑️ Marking ${contactOperations.delete.length} contacts as inactive...`);
      
      for (const contactId of contactOperations.delete) {
        try {
          const deleteData = {
            properties: {
              "Contact Type": {
                select: { name: "Inactive" }
              },
              "Notes": {
                rich_text: [{ 
                  text: { 
                    content: `Marked inactive during conference registration on ${new Date().toISOString().split('T')[0]}` 
                  } 
                }]
              }
            }
          };

          const deleteResponse = await fetch(`https://api.notion.com/v1/pages/${contactId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify(deleteData)
          });

          if (deleteResponse.ok) {
            results.deleted.push(contactId);
            console.log(`✅ Marked contact as inactive: ${contactId}`);
          } else {
            const errorData = await deleteResponse.json();
            results.errors.push(`Failed to delete contact: ${errorData.message}`);
          }
        } catch (error) {
          results.errors.push(`Error deleting contact: ${error.message}`);
        }
      }
    }
    // DEBUG: Check if we reach the tagging section
    console.log('🔍 DEBUG - About to check conference team tagging...');
    console.log('🔍 DEBUG - contactOperations.conferenceTeam exists:', !!contactOperations.conferenceTeam);
    console.log('🔍 DEBUG - contactOperations.conferenceTeam length:', contactOperations.conferenceTeam?.length);

    // Step 5: Handle conference team tagging
    if (contactOperations.conferenceTeam) {
      console.log(`🏷️ Processing conference team tagging...`);
      
      // First, we need to get the tag IDs from the Tag System database
      const tagSystemDbId = process.env.NOTION_TAG_SYSTEM_DB_ID || '1f9a69bf0cfd8034b919f51b7c4f2c67';
      
      // Get the tags we need
      const tagsToFind = ['26 Conference Delegate', 'Primary Contact', 'Secondary Contact'];
      const tagIds = {};
      
      for (const tagName of tagsToFind) {
        try {
          const tagResponse = await fetch(`https://api.notion.com/v1/databases/${tagSystemDbId}/query`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify({
              filter: {
                property: 'Name', // Assuming the tag name property is called 'Name'
                title: { equals: tagName }
              }
            })
          });
          
          const tagData = await tagResponse.json();
          if (tagData.results.length > 0) {
            tagIds[tagName] = tagData.results[0].id;
            console.log(`🏷️ Found tag "${tagName}": ${tagIds[tagName]}`);
          } else {
            console.error(`❌ Tag "${tagName}" not found in Tag System database`);
          }
        } catch (error) {
          console.error(`💥 Error finding tag "${tagName}":`, error);
        }
      }
      
      // Now process each team member
      for (const teamMember of contactOperations.conferenceTeam) {
        if (!teamMember.id || teamMember.id === 'undefined') {
          console.error(`❌ Invalid team member ID: ${teamMember.id}`);
          results.errors.push(`Invalid team member ID: ${teamMember.id}`);
          continue;
        }
        
        try {
          // Get the contact's current tags
          const contactResponse = await fetch(`https://api.notion.com/v1/pages/${teamMember.id}`, {
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Notion-Version': '2022-06-28'
            }
          });
          
          if (!contactResponse.ok) {
            console.error(`❌ Failed to get contact ${teamMember.id}`);
            continue;
          }
          
          const contact = await contactResponse.json();
          const currentTags = contact.properties['Personal Tag']?.relation || [];
          
          // Start with existing tags (minus the ones we're managing)
          const managedTagIds = Object.values(tagIds);
          const keepTags = currentTags.filter(tag => !managedTagIds.includes(tag.id));
          
          // Add conference delegate tag if attending
          if (teamMember.attending && tagIds['26 Conference Delegate']) {
            keepTags.push({ id: tagIds['26 Conference Delegate'] });
          }
          
          // Add role tag (Primary or Secondary Contact)
          if (teamMember.isPrimary && tagIds['Primary Contact']) {
            keepTags.push({ id: tagIds['Primary Contact'] });
          } else if (!teamMember.isPrimary && tagIds['Secondary Contact']) {
            keepTags.push({ id: tagIds['Secondary Contact'] });
          }
          
          // Update the contact with new tags
          const updateData = {
            properties: {
              "Personal Tag": {
                relation: keepTags
              }
            }
          };
          
          const updateResponse = await fetch(`https://api.notion.com/v1/pages/${teamMember.id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${notionToken}`,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify(updateData)
          });
          
          if (updateResponse.ok) {
            const attendingStatus = teamMember.attending ? 'ATTENDING' : 'NOT ATTENDING';
            const roleStatus = teamMember.isPrimary ? 'PRIMARY CONTACT' : 'SECONDARY CONTACT';
            console.log(`✅ Updated ${teamMember.id}: ${attendingStatus}, ${roleStatus}`);
          } else {
            const errorData = await updateResponse.json();
            console.error(`❌ Failed to update tags for ${teamMember.id}:`, errorData);
            results.errors.push(`Failed to update tags for contact: ${errorData.message}`);
          }
          
        } catch (error) {
          console.error(`💥 Error processing team member ${teamMember.id}:`, error);
          results.errors.push(`Error processing team member: ${error.message}`);
        }
      }
    }

    // Step 6: Return results
    console.log('🎉 Conference team operations complete!');
    console.log(`- Created: ${results.created.length}`);
    console.log(`- Updated: ${results.updated.length}`);
    console.log(`- Deleted: ${results.deleted.length}`);
    console.log(`- Errors: ${results.errors.length}`);

    res.status(200).json({
      success: true,
      results: results,
      message: `Processed ${results.created.length + results.updated.length + results.deleted.length} contact operations`
    });

  } catch (error) {
    console.error('💥 Error processing conference team:', error);
    res.status(500).json({ 
      error: 'Failed to save conference team', 
      details: error.message 
    });
  }
}
