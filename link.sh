
if [ -z "$1" ]
then
  npm link @nexus-switchboard/nexus-core || exit
  npm link @nexus-switchboard/nexus-conn-jira || exit
  npm link @nexus-switchboard/nexus-conn-slack || exit
  npm link @nexus-switchboard/nexus-conn-pagerduty || exit
elif [ "$1" == "reset" ]
then
  rm -rf ./node_modules || exit
  npm i || exit
fi

