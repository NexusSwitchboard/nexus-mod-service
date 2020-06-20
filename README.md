# Nexus Module - Service

The Service module provides functionality that provides ways of interacting with a service team through Slack and Jira.
It provides a deeper and purpose-built set of integrations between slack and Jira that are not available with the Jira

# Features
1. Using either a slash command or _action_ to initiate the request dialog
2. Creates an issue in Jira and allows users to update the status of the ticket from Slack.  
3. All conversation that happens in the Slack thread associated with the request gets added as a comment to the Jira ticket.
4. Communicate with 
# How It Works

## Message Action
A new action will appear in the actions menu named something like _Submit Service Request_ (when you create the slack app, you can specify whatever you want for the text).

## Slash Command
There is a slash command invoked with `/<REQUEST_COMMAND_NAME> [description]` (you can configure it however you want keeping in mind that the command name needs to be set both in the Slack App configuration UI (<instance>.slack.com/admin) and in the service module configuration's `REQUEST_COMMAND_NAME` config variable).     

## Behavior
No matter how a submission request is invoked, a modal appears allowing the user to enter request details.  
It will be pre-populated with the text in the message or command that was used to invoke it.

When the modal is submitted, a Jira Ticket is created and associated with the channel in which the message first appeared.  It will also post a reply in the thread with information about the ticket submitted and action buttons that allow folks to cancel, claim and complete the ticket directly from Slack.

In addition to the creation and status updates, the slack thread that is associated with the ticket will monitor any posts and submit those as comments on the Jira ticket with a reference back to the originating slack conversation.

### Primary and Notification Channels
You can configure the service to invoke a request in any channel but have all the updates happen in the primary channel.  In this case, the channel that gets the majority of the updates is called `Primary` and the `Notification` channel is the one where the request was initiated - it gets references to changes but not all the detail.  This is meant for cases where users want the convienience of starting a conversation from their own channels. 

### Direct Message Notifications
In addition to the notifications mentioned above, users will get DMs from the module when status changes along with a link back to the request.  This is to help with ensuring that all parties are aware of the status of the ticket at all times.


# Implementation
The ServiceRequest class is where the bulk of the functionality lives. The `lib/jira/webhooks.ts`, `lib/slack/events.ts` and `lib/slack/interactions.ts` files are where the events and interactions are received from both slack and Jira.  

## Associating Slack with Jira and vice versa
The most important thing to remember is that we use the channel and timestamp of the thread to associate slack actions with the created ticket.  To do that, we submit the channel/ts combo as a label in Jira and use that to reference back to the original slack message and action areas.  That label is what allows us to initially find the ticket but we store additional information as hidden properties of the Jira issue using the Issue Properties APIs.  Information included in the properties live under the key configured with the `REQUEST_JIRA_SERVICE_LABEL` setting and include the channel, thread ts, action message ts and the originating slack user ID.

## Associating Slack Users with Jira Users
In order for the create, claim, cancel and complete actions to set the reporter and assignee properly based on the slack user who is performing the action, we assume that the email associated with the slack user is the same as the email associated with the jira user.  *If that is not the case, then user operations will not work.*

# Flow Orchestration
When events are received by the module, they are quickly shuffled off to the Flow Orchestration static object.  Based on the action that triggered the event, the proper call will be made to complete the request.  For example, if the ACTION_CLAIM_REQUEST action is initiated, a call to `request.claim` will follow.

# Jira Configuration
The workflow associated with the project you are connecting to this module must be configured in a way that will allow for proper integration:

1. Ensure that your transitions are correctly set in the nexus configuration.  You case see the IDs of your transitions in a workflow by visiting the text version of your workflow editor.
2. Ensure that your statuses are configured correctly.  Nexus will attempt to translate the status strings into IDs for you (when necessary).  You can check your statuses most easily in the text or diagram view of your workflow.
3. Nexus attempts to set the resolution during the transition from any status to a "done" status.  This will fail if the configured transition does not have a screen associated with it that includes the transition field.  The resolution being set is important because as of now the same status is used for "Completed" and "Cancelled" and depends on the "resolution" field to differentiate between the two.
4. If you see a log error during creation of a ticket saying something about a reporter not being able to be set, this is likely the result of the API user/key you are using does not have _Modify Reporter_ permission in the project.  To overcome this and other issues, set your API user to be an administrator in the project that is associated.
5. Old style projects did not have the notion of epic relationships built in as parent/child relationships unfortunately. Instead, they are indicated under the hood using the "Epic Link" field which is actually a custom field.  Since it's a custom field, it does not appear consistently in the fields list of issue object.  Different accounts could have different names for this field.  For example, one might be `customfield_10008` while another could be `customfield_12220`.  That is why you must set this field correctly in your configuration.  If you are using a "next-gen" project then this field can be left empty and only the epic key config will be used.
6. Your project must have at least one component.  If not, the user will not see the create modal when initiating a request.  
7. The issue type ID must be set to ensure that the correct type of issue is being created.  You can find the ID of issue types by going to the issue types settings and hovering over the type you want to use - the link _should_ indicate the type id.

Here are the module configuration values that can and, in most cases, must be set:
 
* `REQUEST_COMMAND_NAME: "<command_name>"`
    * This is the name of the slash command for initiating a request

* `REQUEST_JIRA_PROJECT: "<JIRA_KEY>"`   
    * This is the project that new requests will be added to
    
* `REQUEST_JIRA_ISSUE_TYPE_ID: "<JIRA_ISSUE_TYPE_ID>"`
    * This is the issue type for the tickets created

* `REQUEST_JIRA_EPIC: "<JIRA_EPIC_PARENT_KEY>"`
    * This is the epic under which the ticket will be created

* `REQUEST_JIRA_START_TRANSITION_ID: 21`
    * This is the transition to use to set the status to some form of _In Progress_

* `REQUEST_JIRA_COMPLETE_TRANSITION_ID: 31`
    *  This is the transition  to use to set the status to some form of _Done_ (note that cancel and complete use the same transition but the resolution is set to "Done" for complete and "Won't Do" for cancelled)

* `REQUEST_JIRA_EPIC_LINK_FIELD": "customfield_10800"`
    * This is the "custom" field name that represents the epic field used for "standard" issue types.  If not given, then it is assumed that we can simply use the REQUEST_JIRA_EPIC as if it were a parent (which is valid for newer issue types).

* `REQUEST_JIRA_RESOLUTION_DISMISS": "Won't Do"`
    * The name of the resolution to use when someone cancels a request.  

* `REQUEST_JIRA_RESOLUTION_DONE": "Done"`
    * The name of the resolution to use when someone completes a request

* `REQUEST_JIRA_DEFAULT_COMPONENT_ID: ""`
    * The ID of the comonent to use if no component is given during issue creation
    
* `REQUEST_JIRA_SERVICE_LABEL: "infrabot"`
    *  This is the prefix/key that is used in the following areas:
        1. The label that is attached to a created issue plus the text "-request" as in "infrabot-request"
        2. The property name used when creating the custom property associated with each issue to store information such as slack thread data.  In this case, it is used as is: "infrabot", for example.

* `REQUEST_JIRA_PRIORITIES: [ServicePriority]`
    * This a list of priorities (in the order they will be displayed) that includes information about the associated 
        Jira Priority.  Every priority in the service module must be mapped to an actual Jira Priority in the Jira instance
        you're using.  
    * These priorities will show up in the request submission dialog in the order they are listed here.
    * The `triggersPagerDuty` boolean indicates whether or not a pagerduty alert will be issued if this priority is selected when the submission is complete.
    * Here is a sample of the structure:
    ```
          "REQUEST_JIRA_PRIORITIES": [
            {
              "name": "Low",
              "jiraName": "Low",
              "triggersPagerDuty": false,
              "description": "It’d be nice to have this today, but I can wait"
            },
            {
              "name": "Medium",
              "jiraName": "Medium",
              "triggersPagerDuty": false,
              "description": "I could use this in the next hour"
            },
            {
              "name": "High",
              "jiraName": "High",
              "triggersPagerDuty": true,
              "description": "Kittens are drowning, wake up and help me!"
            }
          ],

    ```    
    Note that the name in the bot and the jira name of the priority are the same here but they don't have to be.
    
     
Here are the Jira _secret_ options that are required:

* `SERVICE_JIRA_HOST: ""`
    * `subdomain`.atlassian.net
* `SERVICE_JIRA_USERNAME: ""`
    * The username is always an email address.  Note that the user you choose must have the necessary permissions to perform the operations necesary (see above)
* `SERVICE_JIRA_API_KEY: ""`
    * The API key for the given user.  This *MUST NOT BE THE PASSWORD* of that user.  Your API key can be generated here: https://id.atlassian.com/manage/api-tokens
* `SERVICE_JIRA_ADDON_CACHE: ""`
    * This is the connection string used to store information about addon clients.  This is necessary if you want to client data in a way that is not using the disk.  Depending on how you deploy this, you may lose that data with each restart without specifying a separate datstore here.  The options are sqlite or redis and connection string documentation is available here:  https://github.com/lukechilds/keyv

* `JIRA_ADDON_KEY: ""`
    * This is the key used to uniquely identify the Jira Addon that is part of the service module.  Avoid using spaces in this key.
    
* `JIRA_ADDON_NAME: ""`
    * This is the name of the Jira Addon as it will appear to the Jira Admin in the addons section of the Jira Admin UI.
       
# PagerDuty Configuration
PagerDuty configuration is only necessary if you have indicated that one or more priorities in the jira priorities configuration should trigger a pager duty request.  All of the pagerduty configuration options are considered secrets and are as follows:

* `SERVICE_PAGERDUTY_TOKEN=`
    * This the token you create for this app within your own PD profile.
    
* `SERVICE_PAGERDUTY_SERVICE_DEFAULT=`
    * This is the ID of the service to use when creating the incident
    
* `SERVICE_PAGERDUTY_ESCALATION_POLICY_DEFAULT=`
    * This is the ID of the escalation policy to use when creating the incident


# Slack Configuration
These are configuration options that tell the module how it should interact with Slack.  

* `SLACK_PRIMARY_CHANNEL: ""`
    * The ID of the channel that will act as the primary.  The primary channel is the one that is always being monitored  by the support team. By itself, this doesn't do anything but it indicates to other options how it should interact with the slack interface.
       
* `SLACK_CONVERSATION_RESTRICTION: ""`
    * The conversation restriction option can be one of the following:
        * invited - In this mode, the request flow will happen only in the channel that it was started in (a notification to the primary channel will be sent if a primary channel is set)
        * primary - In this mode, the request flow will always happen in the primar channel (if one is specified).  Some updates will be sent to the primary channel, though.

You can also specify the emoji to be used within the messages that are rendered in slack:

* `REQUEST_COMPLETED_SLACK_ICON": ":<emoji_name>:"`
* `REQUEST_CANCELLED_SLACK_ICON": ":<emoji_name>:"`
* `REQUEST_CLAIMED_SLACK_ICON": ":<emoji_name>:"`
* `REQUEST_SUBMITTED_SLACK_ICON": ":<emoji_name>:"`
* `REQUEST_WORKING_SLACK_ICON": ":<emoji_name>:"`
* `REQUEST_EDITING_SLACK_ICON": ":<emoji_name>:"`
* `REQUEST_ERROR_SLACK_ICON": ":<emoji_name>:"`

# Slack App Configuration
You will need the following configuration options set in the Slack App you create and point to your instance of the module:

1. Intractive Components
   1. Enable
   2. Add Action: Callback ID is submit_infra_request
   3. Action Name: Whatever you want
   4. Request URL: https://<your_dmoain>/m/service/slack/interactions
   
2. Slash Commands
   1. Create a new slash command - you can call it whatever you want though the name will be used in the URL (below) 
   3. Set the request URL to https://<your_domain>/m/service/slack/commands/<command_name>
   
3. OAuth & Permissions
   1. Scopes - See below for the scopes that you will need to add and request permission from users to apply
   2. Bot User - Add a bot and name it whatever you want
   3. Always Show My Bot Online - Set to "On" (but not required)

4. Bot Events

These are the slack configuration settings that are specified in the module config and are required to connect and interact properly with Slack:

* `SERVICE_SLACK_APP_ID: ""` 
    - The app ID specified in your app's admin page: https://api.slack.com/apps/`appid`  
* `SERVICE_SLACK_CLIENT_ID: ""` 
    - The client ID specified in your app's admin page: https://api.slack.com/apps/`appid`
* `SERVICE_SLACK_CLIENT_SECRET: ""` 
    - The client secret specified in your app's admin page: https://api.slack.com/apps/`appid`
* `SERVICE_SLACK_SIGNING_SECRET: ""`  
    - The signing secret specified in your app's admin page: https://api.slack.com/apps/`appid` 
* `SERVICE_SLACK_CLIENT_OAUTH_TOKEN: ""`  
    - The "OAuth Access Token" in your app's admin page: https://api.slack.com/apps/`appid`/oauth
* `SERVICE_SLACK_USER_OAUTH_TOKEN: ""` 
    - The "Bot User OAuth Access Token" in your app's admin page: https://api.slack.com/apps/`appid`/oauth

Here are the module configuration options that can be set for the Slack integration that can be set:

* `REQUEST_COMPLETED_SLACK_ICON: ""`
    * The icon to use for this state (note that it should have the :<name>: format and should be available in the workspace into which the app is deployed)
* `REQUEST_CANCELLED_SLACK_ICON: ""`
    * The icon to use for this state (note that it should have the :<name>: format and should be available in the workspace into which the app is deployed)

* `REQUEST_CLAIMED_SLACK_ICON: ""`
    * The icon to use for this state (note that it should have the :<name>: format and should be available in the workspace into which the app is deployed)

* `REQUEST_SUBMITTED_SLACK_ICON: ""`
    * The icon to use for this state (note that it should have the :<name>: format and should be available in the workspace into which the app is deployed)

* `REQUEST_WORKING_SLACK_ICON: ""`
    * The icon to use for this state (note that it should have the :<name>: format and should be available in the workspace into which the app is deployed)

* `REQUEST_EDITING_SLACK_ICON: ""`
    * The icon to use for this state (note that it should have the :<name>: format and should be available in the workspace into which the app is deployed)

* `REQUEST_ERROR_SLACK_ICON: ""`
    * The icon to use for this state (note that it should have the :<name>: format and should be available in the workspace into which the app is deployed)

* `SLACK_BOT_USERNAME: ""`
    * The name of the bot user given in your Slack app.  If this does not match (case insensitive) then the module will not be able to correctly identify its own messages which will cause some problems during ticket status updates in Slack.
    
## Slack App Permissions
The Slack App requires the following OAuth roles to function properly:

* *bot* - Required for having a bot presence that can behave as a user and be mentioned and DM'd
* *channels:history* - Required to pull message information from a channel
* *groups:history* - Required to pull message information from a user's private chanel
* *im:history* - Required to pull message information from the user's DMs
* *mpim:history* - Required to pull message information from the users' multi-person DMs
* *users:read* - Required to pull profile information needed to connect Jira with Slack
* *users:read.email* - Required to pull user's email needed to connect Jira with Slack
* *users:profile:read* - Required to pull users' display_name field (the @<name>)
* *chat:write:bot* - Required to create new message as the app bot user
* *chat:write:user* - Required to create new messages in the name of the initiating user.
 
# Configuration Options

Note that the SERVICE_ prefix is only necessary when stored as environment variables.  See documentation on cnofiguration secrets in the main `README.md`
