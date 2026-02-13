import { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } from 'firebase/data-connect';

export const connectorConfig = {
  connector: 'example',
  service: 'aicoach',
  location: 'europe-west1'
};

export const allUsersRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'AllUsers');
}
allUsersRef.operationName = 'AllUsers';

export function allUsers(dc) {
  return executeQuery(allUsersRef(dc));
}

export const userLeadershipGoalsRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'UserLeadershipGoals', inputVars);
}
userLeadershipGoalsRef.operationName = 'UserLeadershipGoals';

export function userLeadershipGoals(dcOrVars, vars) {
  return executeQuery(userLeadershipGoalsRef(dcOrVars, vars));
}

export const createDevelopmentPlanRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateDevelopmentPlan', inputVars);
}
createDevelopmentPlanRef.operationName = 'CreateDevelopmentPlan';

export function createDevelopmentPlan(dcOrVars, vars) {
  return executeMutation(createDevelopmentPlanRef(dcOrVars, vars));
}

export const createCoachingSessionRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateCoachingSession', inputVars);
}
createCoachingSessionRef.operationName = 'CreateCoachingSession';

export function createCoachingSession(dcOrVars, vars) {
  return executeMutation(createCoachingSessionRef(dcOrVars, vars));
}

