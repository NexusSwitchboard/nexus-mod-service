# Nexus Module - Service

The Service module provides functionality that provides ways of interacting with a service team through Slack and Jira.
It provides a deeper and purpose-built set of integrations between slack and Jira that are not available with the Jira

# Features
1. Using either a slash command or _action_ to initiate the request dialog
2. Creates an issue in Jira and allows users to update the status of the ticket from Slack.  
3. All conversation that happens in the Slack thread associated with the request gets added as a comment to the Jira ticket and vice versa.

# How It Works

## Global Action
A new action will appear in the global actions menu named something - the text of the action depends on how it was configured in the Slack App settings.

## Message Action
A new action will appear in the message actions menu  - the text of the action depends on how it was configured in the Slack App settings.

## Slash Command
There is a slash command invoked with `/<intents.<intent_name>.slashCommand> [description]` (you can configure it however you want keeping in mind that the command name needs to be set both in the Slack App configuration UI (<instance>.slack.com/admin) and in the service module configuration's `REQUEST_COMMAND_NAME` config variable).     

## Behavior
No matter how a submission request is invoked, a modal appears allowing the user to enter request details.  
It will be pre-populated with the text in the message or command that was used to invoke it.  If a global action triggered it then there will be no pre-populated text.

When the modal is submitted, a Jira Ticket is created and associated with the channel in which the message first appeared.  It will also post a reply in the thread with information about the ticket submitted and action buttons that allow folks to cancel, claim and complete the ticket directly from Slack.

In addition to the creation and status updates, the slack thread that is associated with the ticket will monitor any posts and submit those as comments on the Jira ticket with a reference back to the originating slack conversation.  The reverse will also be true.  If Jira comments are committed, they will show up as replies in Slack.

### Primary and Notification Channels
You can configure the service to invoke a request in any channel but have all the updates happen in the primary channel.  In this case, the channel that gets the majority of the updates is called `Primary` and the `Notification` channel is the one where the request was initiated - it gets references to changes but not all the detail.  This is meant for cases where users want the convienience of starting a conversation from their own channels. 

### Direct Message Notifications
In addition to the notifications mentioned above, users will get DMs from the module when status changes along with a link back to the request.  This is to help with ensuring that all parties are aware of the status of the ticket at all times.


# Implementation

## Intents, Flows and Actions
When you get into the code you're going to see references to Intents, Flows and Actions.  Here's a breakdown of what those things are.

* **Intents** - An intent is an encapsulation of a type of request.  The best way to understand what an intent is to understand its configuration.  Intents hold configuration variables for:
    * Which Jira project to use
    * The name of the slash command to look for
    * The slack channel that acts as the primary channel
    * The configurable text to use during execution of workflows.
    * How to render a modal
    
    You can think of intents as a workflow - the path a _type_ of ticket takes through the process of execution.
    
* **Flows** - An intent is made up of flows.  Flows are groups of actions that represent a major part of a workflow.  There are a couple of different flows: Intake and Claim.  The intake flow handles the rendering of the modal and the initial creation of a ticket.  The claim flow handles everything that happens after that (claim, complete or cancel).  The flows handle not only picking the actions that are executed but also how to interact with the user (through Slack).  

* **Actions** - An action is a unit of behavrior that is narrowly scoped.  For example, a `create` action will create a ticket while a `claim` action will mark a ticket as claimed.  This separation allows us to create custom flows that are made up of the same actions but in different ways.  It's important to note that Flows handle the immediate responses (they are capable of immediate updates to slack) as opposed to delayed responses.  For example, any work that needs to be done immediately (since Slack responses are sometimes timed) should be done in the Flow.  Actions pay no attention to speed of response.

## Associating Slack with Jira and vice versa
The most important thing to remember is that we use the channel and timestamp of the thread to associate slack actions with the created ticket.  To do that, we submit the channel/ts combo as a label in Jira and use that to reference back to the original slack message and action areas.  That label is what allows us to initially find the ticket but we store additional information as hidden properties of the Jira issue using the Issue Properties APIs.  Information included in the properties live under the key configured with the `REQUEST_JIRA_SERVICE_LABEL` setting and include the channel, thread ts, action message ts and the originating slack user ID.

## Associating Slack Users with Jira Users
In order for the create, claim, cancel and complete actions to set the reporter and assignee properly based on the slack user who is performing the action, we assume that the email associated with the slack user is the same as the email associated with the jira user.  *If that is not the case, then user operations will not work.*

# Configuration

There are several levels of configuration to keep in mind.  These are:

1. Module Level - These are settings that apply to the entire instance of the module.  Things like secrets, global pagerDuty settings (service, policy default), global Jira settings (hostname, addon info) and global slack settings and the list of intent configurations.

2. Intent Level - A module config can define one or more intents. The intent configuration contains things like jira workflow details, slash command to look for, what the request creation modal looks like, slack interaction details (e.g. primary channel) and some text replacements.

## Secrets
At the module level, there is a property called `secrets` that contains a list of special config vars that should never be defined in the main config file.  Instead, the keys will be used to do a lookup in the environment for variables named using this format: `SERVICE_<key>`.  So for example, if you have this in your secrets:
```json
{
  "secrets": {
    "myVar1": "",
    "myVar2": ""
  }
}
```
The follow environment variables will be expected:
* `SERVICE_myVar1`
* `SERVICE_myVar2`

## Jira Configuration Notes
The workflow associated with the project you are connecting to this module must be configured in a way that will allow for proper integration:

1. Ensure that your transitions are correctly set in the nexus configuration.  You case see the IDs of your transitions in a workflow by visiting the text version of your workflow editor.
2. Ensure that your statuses are configured correctly.  Nexus will attempt to translate the status strings into IDs for you (when necessary).  You can check your statuses most easily in the text or diagram view of your workflow.
3. Nexus attempts to set the resolution during the transition from any status to a "done" status.  This will fail if the configured transition does not have a screen associated with it that includes the transition field.  The resolution being set is important because as of now the same status is used for "Completed" and "Cancelled" and depends on the "resolution" field to differentiate between the two.
4. If you see a log error during creation of a ticket saying something about a reporter not being able to be set, this is likely the result of the API user/key you are using does not have _Modify Reporter_ permission in the project.  To overcome this and other issues, set your API user to be an administrator in the project that is associated.
5. Old style projects did not have the notion of epic relationships built in as parent/child relationships unfortunately. Instead, they are indicated under the hood using the "Epic Link" field which is actually a custom field.  Since it's a custom field, it does not appear consistently in the fields list of issue object.  Different accounts could have different names for this field.  For example, one might be `customfield_10008` while another could be `customfield_12220`.  That is why you must set this field correctly in your configuration.  If you are using a "next-gen" project then this field can be left empty and only the epic key config will be used.
6. Your project must have at least one component.  If not, the user will not see the create modal when initiating a request.  
7. The issue type ID must be set to ensure that the correct type of issue is being created.  You can find the ID of issue types by going to the issue types settings and hovering over the type you want to use - the link _should_ indicate the type id.

## PagerDuty Configuration Notes
PagerDuty configuration is only necessary if you have indicated that one or more priorities in the jira priorities configuration should trigger a pager duty request.  All of the pagerduty configuration options are considered secrets and are as follows:

## Slack Configuration Notes
Beyond the configuration in the nexus implementation for Slack, you will need the following configuration options set in the Slack App you create and point to your instance of the module:

1. Interactive Components
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
    
### Slack App Permissions
The Slack App requires the following OAuth roles to function properly:

#### Bot Token Scopes
* channels:history - View messages and other content in public channels that DaplBot has been added to
* chat:write - Send messages as @daplbot
* groups:history - View messages and other content in private channels that DaplBot has been added to
* im:history - View messages and other content in direct messages that DaplBot has been added to
* mpim:history - View messages and other content in group direct messages that DaplBot has been added to
* users.profile:read - View profile details about people in the workspace
* users:read - View people in the workspace

#### User Token Scopes

* channels:history - View messages and other content in the user’s public channels
* groups:history - View messages and other content in the user’s private channels
* im:history - View messages and other content in the user’s direct messages
* mpim:history - View messages and other content in the user’s group direct messages
* users.profile:read - View profile details about people in the workspace
* users:read - View people in the workspace
* users:read.email - View email addresses of people in the workspace
