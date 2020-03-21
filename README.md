# Nexus Module - Service

Nexus is a framework for connecting different services together that is made up of modules and connections.  This repo
is a module dedicated to providing a slack-based interface to Jira for accepting requests and transitioning them through the 
 lifecycle of the project with which it is connected.

For full documentation on how to use this, visit the the [Nexus documentation here](https://nexus-switchboard.dev/content/modules/service)

## Development

To make changes to this repo, fork and clone into a directory.  Then:

1. `npm install`
2. `npm run build`
3. `npm link`

The last step hooks your local npm cache to this project instead of pulling from the public NPM registry.   That way, in the project that uses this package, you can run (in the *other* project's directory, not this one):

`npm link @nexus-switchboard/nexus-mod-service`

