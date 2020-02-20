# Service - Nexus Module
The Service module provides functionality that provides ways of interacting with a service team through existing tools

# Features
1. Using either a slash command or _action_ to initiate the request dialog
2. Creates an issue in Jira and allows users to update the status of the ticket from Slack.  
3. All conversation that happens in the Slack thread associated with the request gets added as a comment to the Jira ticket.

# How It Works

## Message Action
A new action will appear in the actions menu named something like _Submit Service Request_ (when you create the slack app, you can specify whatever you want for the text).

### Slash Command
There is a slash command invoked with `/request [description]` (you can call it whatever you want).     

### Behavior
No matter how a submission request is invoked, a modal appears allowing the user to enter request details.  
It will be pre-populated with the text in the message or command that was used to invoke it.

When the modal is submitted, a Jira Ticket is created and associated with the channel in which the message first appeared.  It will also post a reply in the thread with information about the ticket submitted and action buttons that allow folks to cancel, claim and complete the ticket directly from Slack.

In addition to the creation and status updates, the slack thread that is associated with the ticket will monitor any posts and submit those as comments on the Jira ticket with a reference back to the originating slack conversation.

## Implementation
The ServiceRequest class is where the bulk of the functionality lives. The `interactions.ts` file is where the interactions are received.  

### Associating Slack with Jira and vice versa
The most important thing to remember is that we use the channel and timestamp of the thread to associate slack actions with the created ticket.  To do that, we submit the channel/ts combo as a label in Jira and use that to reference back to the original slack message and action areas.

### Associating Slack Users with Jira Users
In order for the create, claim, cancel and complete actions to set the reporter and assignee properly based on the slack user who is performing the action, we assume that the email associated with the slack user is the same as the email associated with the jira user.  *If that is not the case, then user operations will not work.*

## Slack App Configuration
You will need the following configuration options set in the Slack App you create and point to your instance of the module:

1. Intractive Components
   1. Enable
   2. Add Action: Callback ID is submit_infra_request
   3. Action Name: Whatever you want
   4. Request URL: https://<your_dmoain>/m/service/slack/interactions
   
2. Slash Commands
   1. Create a new slash command - you can call it whatever you want though the name will be used in the URL (below) 
   3. Set the request URL to https://<your_domain>/m/service/slack/commands/<command_name>
   
2. OAuth & Permissions
   1. Scopes - See below for the scopes that you will need to add and request permission from users to apply
   2. Bot User - Add a bot and name it whatever you want
   3. Always Show My Bot Online - Set to "On" (but not required)

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
 
## Module Configuration

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
    
The following are connection-specific configuration options:

* *SERVICE*_SLACK_APP_ID: [`string`]
* *SERVICE*_SLACK_CLIENT_ID: [`string`]
* *SERVICE*_SLACK_CLIENT_SECRET: [`string`]
* *SERVICE*_SLACK_SIGNING_SECRET: [`string`]
* *SERVICE*_SLACK_CLIENT_OAUTH_TOKEN: xoxp-[`string`]
* *SERVICE*_SLACK_USER_OAUTH_TOKEN: xoxb-[`string`]*
* *SERVICE*_JIRA_HOST: [`subdomain`].atlassian.net
* *SERVICE*_JIRA_USERNAME: [`email`]
* *SERVICE*_JIRA_API_KEY: [`user_api_key`]

Note that the SERVICE_ prefix is only necessary when stored as environment variables.  See documentation on cnofiguration secrets in the main `README.md`
