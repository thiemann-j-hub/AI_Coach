# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `example`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

**If you're looking for the `React README`, you can find it at [`dataconnect-generated/react/README.md`](./react/README.md)**

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*AllUsers*](#allusers)
  - [*UserLeadershipGoals*](#userleadershipgoals)
- [**Mutations**](#mutations)
  - [*CreateDevelopmentPlan*](#createdevelopmentplan)
  - [*CreateCoachingSession*](#createcoachingsession)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `example`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@dataconnect/generated` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## AllUsers
You can execute the `AllUsers` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
allUsers(): QueryPromise<AllUsersData, undefined>;

interface AllUsersRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<AllUsersData, undefined>;
}
export const allUsersRef: AllUsersRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
allUsers(dc: DataConnect): QueryPromise<AllUsersData, undefined>;

interface AllUsersRef {
  ...
  (dc: DataConnect): QueryRef<AllUsersData, undefined>;
}
export const allUsersRef: AllUsersRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the allUsersRef:
```typescript
const name = allUsersRef.operationName;
console.log(name);
```

### Variables
The `AllUsers` query has no variables.
### Return Type
Recall that executing the `AllUsers` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `AllUsersData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `AllUsers`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, allUsers } from '@dataconnect/generated';


// Call the `allUsers()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await allUsers();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await allUsers(dataConnect);

console.log(data.users);

// Or, you can use the `Promise` API.
allUsers().then((response) => {
  const data = response.data;
  console.log(data.users);
});
```

### Using `AllUsers`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, allUsersRef } from '@dataconnect/generated';


// Call the `allUsersRef()` function to get a reference to the query.
const ref = allUsersRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = allUsersRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.users);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.users);
});
```

## UserLeadershipGoals
You can execute the `UserLeadershipGoals` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
userLeadershipGoals(vars: UserLeadershipGoalsVariables): QueryPromise<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;

interface UserLeadershipGoalsRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UserLeadershipGoalsVariables): QueryRef<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;
}
export const userLeadershipGoalsRef: UserLeadershipGoalsRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
userLeadershipGoals(dc: DataConnect, vars: UserLeadershipGoalsVariables): QueryPromise<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;

interface UserLeadershipGoalsRef {
  ...
  (dc: DataConnect, vars: UserLeadershipGoalsVariables): QueryRef<UserLeadershipGoalsData, UserLeadershipGoalsVariables>;
}
export const userLeadershipGoalsRef: UserLeadershipGoalsRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the userLeadershipGoalsRef:
```typescript
const name = userLeadershipGoalsRef.operationName;
console.log(name);
```

### Variables
The `UserLeadershipGoals` query requires an argument of type `UserLeadershipGoalsVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UserLeadershipGoalsVariables {
  userId: UUIDString;
}
```
### Return Type
Recall that executing the `UserLeadershipGoals` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UserLeadershipGoalsData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `UserLeadershipGoals`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, userLeadershipGoals, UserLeadershipGoalsVariables } from '@dataconnect/generated';

// The `UserLeadershipGoals` query requires an argument of type `UserLeadershipGoalsVariables`:
const userLeadershipGoalsVars: UserLeadershipGoalsVariables = {
  userId: ..., 
};

// Call the `userLeadershipGoals()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await userLeadershipGoals(userLeadershipGoalsVars);
// Variables can be defined inline as well.
const { data } = await userLeadershipGoals({ userId: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await userLeadershipGoals(dataConnect, userLeadershipGoalsVars);

console.log(data.leadershipGoals);

// Or, you can use the `Promise` API.
userLeadershipGoals(userLeadershipGoalsVars).then((response) => {
  const data = response.data;
  console.log(data.leadershipGoals);
});
```

### Using `UserLeadershipGoals`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, userLeadershipGoalsRef, UserLeadershipGoalsVariables } from '@dataconnect/generated';

// The `UserLeadershipGoals` query requires an argument of type `UserLeadershipGoalsVariables`:
const userLeadershipGoalsVars: UserLeadershipGoalsVariables = {
  userId: ..., 
};

// Call the `userLeadershipGoalsRef()` function to get a reference to the query.
const ref = userLeadershipGoalsRef(userLeadershipGoalsVars);
// Variables can be defined inline as well.
const ref = userLeadershipGoalsRef({ userId: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = userLeadershipGoalsRef(dataConnect, userLeadershipGoalsVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.leadershipGoals);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.leadershipGoals);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## CreateDevelopmentPlan
You can execute the `CreateDevelopmentPlan` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createDevelopmentPlan(vars: CreateDevelopmentPlanVariables): MutationPromise<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;

interface CreateDevelopmentPlanRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateDevelopmentPlanVariables): MutationRef<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;
}
export const createDevelopmentPlanRef: CreateDevelopmentPlanRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createDevelopmentPlan(dc: DataConnect, vars: CreateDevelopmentPlanVariables): MutationPromise<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;

interface CreateDevelopmentPlanRef {
  ...
  (dc: DataConnect, vars: CreateDevelopmentPlanVariables): MutationRef<CreateDevelopmentPlanData, CreateDevelopmentPlanVariables>;
}
export const createDevelopmentPlanRef: CreateDevelopmentPlanRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createDevelopmentPlanRef:
```typescript
const name = createDevelopmentPlanRef.operationName;
console.log(name);
```

### Variables
The `CreateDevelopmentPlan` mutation requires an argument of type `CreateDevelopmentPlanVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateDevelopmentPlanVariables {
  leadershipGoalId: UUIDString;
  name: string;
  startDate: DateString;
  status: string;
}
```
### Return Type
Recall that executing the `CreateDevelopmentPlan` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateDevelopmentPlanData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateDevelopmentPlanData {
  developmentPlan_insert: DevelopmentPlan_Key;
}
```
### Using `CreateDevelopmentPlan`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createDevelopmentPlan, CreateDevelopmentPlanVariables } from '@dataconnect/generated';

// The `CreateDevelopmentPlan` mutation requires an argument of type `CreateDevelopmentPlanVariables`:
const createDevelopmentPlanVars: CreateDevelopmentPlanVariables = {
  leadershipGoalId: ..., 
  name: ..., 
  startDate: ..., 
  status: ..., 
};

// Call the `createDevelopmentPlan()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createDevelopmentPlan(createDevelopmentPlanVars);
// Variables can be defined inline as well.
const { data } = await createDevelopmentPlan({ leadershipGoalId: ..., name: ..., startDate: ..., status: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createDevelopmentPlan(dataConnect, createDevelopmentPlanVars);

console.log(data.developmentPlan_insert);

// Or, you can use the `Promise` API.
createDevelopmentPlan(createDevelopmentPlanVars).then((response) => {
  const data = response.data;
  console.log(data.developmentPlan_insert);
});
```

### Using `CreateDevelopmentPlan`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createDevelopmentPlanRef, CreateDevelopmentPlanVariables } from '@dataconnect/generated';

// The `CreateDevelopmentPlan` mutation requires an argument of type `CreateDevelopmentPlanVariables`:
const createDevelopmentPlanVars: CreateDevelopmentPlanVariables = {
  leadershipGoalId: ..., 
  name: ..., 
  startDate: ..., 
  status: ..., 
};

// Call the `createDevelopmentPlanRef()` function to get a reference to the mutation.
const ref = createDevelopmentPlanRef(createDevelopmentPlanVars);
// Variables can be defined inline as well.
const ref = createDevelopmentPlanRef({ leadershipGoalId: ..., name: ..., startDate: ..., status: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createDevelopmentPlanRef(dataConnect, createDevelopmentPlanVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.developmentPlan_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.developmentPlan_insert);
});
```

## CreateCoachingSession
You can execute the `CreateCoachingSession` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createCoachingSession(vars: CreateCoachingSessionVariables): MutationPromise<CreateCoachingSessionData, CreateCoachingSessionVariables>;

interface CreateCoachingSessionRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateCoachingSessionVariables): MutationRef<CreateCoachingSessionData, CreateCoachingSessionVariables>;
}
export const createCoachingSessionRef: CreateCoachingSessionRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createCoachingSession(dc: DataConnect, vars: CreateCoachingSessionVariables): MutationPromise<CreateCoachingSessionData, CreateCoachingSessionVariables>;

interface CreateCoachingSessionRef {
  ...
  (dc: DataConnect, vars: CreateCoachingSessionVariables): MutationRef<CreateCoachingSessionData, CreateCoachingSessionVariables>;
}
export const createCoachingSessionRef: CreateCoachingSessionRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createCoachingSessionRef:
```typescript
const name = createCoachingSessionRef.operationName;
console.log(name);
```

### Variables
The `CreateCoachingSession` mutation requires an argument of type `CreateCoachingSessionVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateCoachingSessionVariables {
  userId: UUIDString;
  summary: string;
  sessionDate: TimestampString;
}
```
### Return Type
Recall that executing the `CreateCoachingSession` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateCoachingSessionData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateCoachingSessionData {
  coachingSession_insert: CoachingSession_Key;
}
```
### Using `CreateCoachingSession`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createCoachingSession, CreateCoachingSessionVariables } from '@dataconnect/generated';

// The `CreateCoachingSession` mutation requires an argument of type `CreateCoachingSessionVariables`:
const createCoachingSessionVars: CreateCoachingSessionVariables = {
  userId: ..., 
  summary: ..., 
  sessionDate: ..., 
};

// Call the `createCoachingSession()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createCoachingSession(createCoachingSessionVars);
// Variables can be defined inline as well.
const { data } = await createCoachingSession({ userId: ..., summary: ..., sessionDate: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createCoachingSession(dataConnect, createCoachingSessionVars);

console.log(data.coachingSession_insert);

// Or, you can use the `Promise` API.
createCoachingSession(createCoachingSessionVars).then((response) => {
  const data = response.data;
  console.log(data.coachingSession_insert);
});
```

### Using `CreateCoachingSession`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createCoachingSessionRef, CreateCoachingSessionVariables } from '@dataconnect/generated';

// The `CreateCoachingSession` mutation requires an argument of type `CreateCoachingSessionVariables`:
const createCoachingSessionVars: CreateCoachingSessionVariables = {
  userId: ..., 
  summary: ..., 
  sessionDate: ..., 
};

// Call the `createCoachingSessionRef()` function to get a reference to the mutation.
const ref = createCoachingSessionRef(createCoachingSessionVars);
// Variables can be defined inline as well.
const ref = createCoachingSessionRef({ userId: ..., summary: ..., sessionDate: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createCoachingSessionRef(dataConnect, createCoachingSessionVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.coachingSession_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.coachingSession_insert);
});
```

