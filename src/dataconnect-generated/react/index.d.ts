import { AllUsersData, UserLeadershipGoalsData, UserLeadershipGoalsVariables, CreateDevelopmentPlanData, CreateDevelopmentPlanVariables, CreateCoachingSessionData, CreateCoachingSessionVariables } from '../';
import { UseDataConnectQueryResult, useDataConnectQueryOptions, UseDataConnectMutationResult, useDataConnectMutationOptions} from '@tanstack-query-firebase/react/data-connect';
import { UseQueryResult, UseMutationResult} from '@tanstack/react-query';
import { DataConnect } from 'firebase/data-connect';
import { FirebaseError } from 'firebase/app';


export function useAllUsers(options?: useDataConnectQueryOptions<AllUsersData>): UseDataConnectQueryResult<AllUsersData, undefined>;
export function useAllUsers(dc: DataConnect, options?: useDataConnectQueryOptions<AllUsersData>): UseDataConnectQueryResult<AllUsersData, undefined>;

export function useUserLeadershipGoals(vars: UserLeadershipGoalsVariables, options?: useDataConnectQueryOptions<UserLeadershipGoalsData>): UseDataConnectQueryResult<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;
export function useUserLeadershipGoals(dc: DataConnect, vars: UserLeadershipGoalsVariables, options?: useDataConnectQueryOptions<UserLeadershipGoalsData>): UseDataConnectQueryResult<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;

export function useCreateDevelopmentPlan(options?: useDataConnectMutationOptions<CreateDevelopmentPlanData, FirebaseError, CreateDevelopmentPlanVariables>): UseDataConnectMutationResult<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;
export function useCreateDevelopmentPlan(dc: DataConnect, options?: useDataConnectMutationOptions<CreateDevelopmentPlanData, FirebaseError, CreateDevelopmentPlanVariables>): UseDataConnectMutationResult<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;

export function useCreateCoachingSession(options?: useDataConnectMutationOptions<CreateCoachingSessionData, FirebaseError, CreateCoachingSessionVariables>): UseDataConnectMutationResult<CreateCoachingSessionData, CreateCoachingSessionVariables>;
export function useCreateCoachingSession(dc: DataConnect, options?: useDataConnectMutationOptions<CreateCoachingSessionData, FirebaseError, CreateCoachingSessionVariables>): UseDataConnectMutationResult<CreateCoachingSessionData, CreateCoachingSessionVariables>;
