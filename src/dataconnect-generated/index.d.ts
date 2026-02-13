import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, MutationRef, MutationPromise } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface AllUsersData {
  users: ({
    id: UUIDString;
    displayName: string;
    email: string;
    bio?: string | null;
    leadershipRole?: string | null;
    photoUrl?: string | null;
    createdAt: TimestampString;
  } & User_Key)[];
}

export interface CoachingSession_Key {
  id: UUIDString;
  __typename?: 'CoachingSession_Key';
}

export interface CreateCoachingSessionData {
  coachingSession_insert: CoachingSession_Key;
}

export interface CreateCoachingSessionVariables {
  userId: UUIDString;
  summary: string;
  sessionDate: TimestampString;
}

export interface CreateDevelopmentPlanData {
  developmentPlan_insert: DevelopmentPlan_Key;
}

export interface CreateDevelopmentPlanVariables {
  leadershipGoalId: UUIDString;
  name: string;
  startDate: DateString;
  status: string;
}

export interface DevelopmentPlan_Key {
  id: UUIDString;
  __typename?: 'DevelopmentPlan_Key';
}

export interface LeadershipGoal_Key {
  id: UUIDString;
  __typename?: 'LeadershipGoal_Key';
}

export interface PlanStep_Key {
  id: UUIDString;
  __typename?: 'PlanStep_Key';
}

export interface Resource_Key {
  id: UUIDString;
  __typename?: 'Resource_Key';
}

export interface UserLeadershipGoalsData {
  leadershipGoals: ({
    id: UUIDString;
    name: string;
    description?: string | null;
    status: string;
    targetDate: DateString;
    achievedDate?: DateString | null;
    createdAt: TimestampString;
  } & LeadershipGoal_Key)[];
}

export interface UserLeadershipGoalsVariables {
  userId: UUIDString;
}

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

interface AllUsersRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<AllUsersData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<AllUsersData, undefined>;
  operationName: string;
}
export const allUsersRef: AllUsersRef;

export function allUsers(): QueryPromise<AllUsersData, undefined>;
export function allUsers(dc: DataConnect): QueryPromise<AllUsersData, undefined>;

interface UserLeadershipGoalsRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UserLeadershipGoalsVariables): QueryRef<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UserLeadershipGoalsVariables): QueryRef<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;
  operationName: string;
}
export const userLeadershipGoalsRef: UserLeadershipGoalsRef;

export function userLeadershipGoals(vars: UserLeadershipGoalsVariables): QueryPromise<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;
export function userLeadershipGoals(dc: DataConnect, vars: UserLeadershipGoalsVariables): QueryPromise<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;

interface CreateDevelopmentPlanRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDevelopmentPlanVariables): MutationRef<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateDevelopmentPlanVariables): MutationRef<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;
  operationName: string;
}
export const createDevelopmentPlanRef: CreateDevelopmentPlanRef;

export function createDevelopmentPlan(vars: CreateDevelopmentPlanVariables): MutationPromise<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;
export function createDevelopmentPlan(dc: DataConnect, vars: CreateDevelopmentPlanVariables): MutationPromise<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;

interface CreateCoachingSessionRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateCoachingSessionVariables): MutationRef<CreateCoachingSessionData, CreateCoachingSessionVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateCoachingSessionVariables): MutationRef<CreateCoachingSessionData, CreateCoachingSessionVariables>;
  operationName: string;
}
export const createCoachingSessionRef: CreateCoachingSessionRef;

export function createCoachingSession(vars: CreateCoachingSessionVariables): MutationPromise<CreateCoachingSessionData, CreateCoachingSessionVariables>;
export function createCoachingSession(dc: DataConnect, vars: CreateCoachingSessionVariables): MutationPromise<CreateCoachingSessionData, CreateCoachingSessionVariables>;

