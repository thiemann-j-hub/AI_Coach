const { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'example',
  service: 'aicoach',
  location: 'europe-west1'
};
exports.connectorConfig = connectorConfig;

const allUsersRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'AllUsers');
}
allUsersRef.operationName = 'AllUsers';
exports.allUsersRef = allUsersRef;

exports.allUsers = function allUsers(dc) {
  return executeQuery(allUsersRef(dc));
};

const userLeadershipGoalsRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'UserLeadershipGoals', inputVars);
}
userLeadershipGoalsRef.operationName = 'UserLeadershipGoals';
exports.userLeadershipGoalsRef = userLeadershipGoalsRef;

exports.userLeadershipGoals = function userLeadershipGoals(dcOrVars, vars) {
  return executeQuery(userLeadershipGoalsRef(dcOrVars, vars));
};

const createDevelopmentPlanRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateDevelopmentPlan', inputVars);
}
createDevelopmentPlanRef.operationName = 'CreateDevelopmentPlan';
exports.createDevelopmentPlanRef = createDevelopmentPlanRef;

exports.createDevelopmentPlan = function createDevelopmentPlan(dcOrVars, vars) {
  return executeMutation(createDevelopmentPlanRef(dcOrVars, vars));
};

const createCoachingSessionRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateCoachingSession', inputVars);
}
createCoachingSessionRef.operationName = 'CreateCoachingSession';
exports.createCoachingSessionRef = createCoachingSessionRef;

exports.createCoachingSession = function createCoachingSession(dcOrVars, vars) {
  return executeMutation(createCoachingSessionRef(dcOrVars, vars));
};
