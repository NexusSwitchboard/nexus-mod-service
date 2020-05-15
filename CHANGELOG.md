*UNRELEASED*
--------------------
Released on: TBD
* *Fixed*: If ticket creation fails when triggered by a Global Shortcut, send an error message in a DM to the reporter so they aren't left with any information about what went wrong.

*0.5.15*
--------------------
* *Fixed*: There was a bug where the home tab was not showing open tickets
* *Fixed*: There is a limit on the number of blocks that can be shown in a view so had to limit the number of tickets show in this view.

*0.5.14*
--------------------
* *Added*: Add vendor information to the app descriptor.

*0.5.13*
--------------------
* *Added*: Extended self-diagnostic to check connections to third-parties like Jira, PagerDuty and Slack.


*0.5.11*
--------------------
* *Hotfix*: Neglected to update one of the packages needed for 0.5.10

*0.5.10*
--------------------
* *Added*: Does a self-diagnostic on the configuration of the module to ensure that everything will operate properly during runtime.  There are now a lot of configuration options that could be incorrectly set and trying to nail that down manually will be difficult.  It can also serve as self-documentation for tracking these detais.


*0.5.9*
--------------------
Released on: _2020-05-07_

* *Added*: Global Shortcuts are now supported by adding a global shortcut with the ID submit_request in your Slack App configurations
* *Added*: Post a notification in a DM to the user who submitted the request when the ticket is created.  This is necessary because of the Global Shortcut which can be started anywhere in Slack.  It's not obvious where the ticket thread was created so this points to the primary channel.
* *Changed*: The callback ID for the Message Shortcut is now `submit_request` as opposed to `submit_infra_request`.  You must change this in the Slack App configuration.

