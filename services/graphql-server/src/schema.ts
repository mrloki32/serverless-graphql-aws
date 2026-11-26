/**
 * Internal schema. Not exposed to the internet: only the Lambda resolvers (inside
 * the VPC, via the internal ALB) can reach it. The caller passes `owner` (the
 * Cognito `sub` it has already authenticated) - a trusted-subsystem model that is
 * enforced by network isolation + the shared internal token.
 */
export const typeDefs = /* GraphQL */ `
  enum TaskStatus {
    TODO
    IN_PROGRESS
    DONE
  }

  type Task {
    id: ID!
    owner: ID!
    title: String!
    description: String
    status: TaskStatus!
    createdAt: String!
    updatedAt: String!
  }

  type TaskStats {
    total: Int!
    todo: Int!
    inProgress: Int!
    done: Int!
  }

  input CreateTaskInput {
    title: String!
    description: String
    status: TaskStatus
  }

  input UpdateTaskInput {
    id: ID!
    title: String
    description: String
    status: TaskStatus
  }

  type Query {
    "Liveness + DB connectivity: 'ok' or 'degraded'"
    health: String!
    task(owner: ID!, id: ID!): Task
    taskStats(owner: ID!): TaskStats!
  }

  type Mutation {
    createTask(owner: ID!, input: CreateTaskInput!): Task!
    "Returns null when the task does not exist for this owner"
    updateTask(owner: ID!, input: UpdateTaskInput!): Task
    "Returns the deleted task, or null when it did not exist for this owner"
    deleteTask(owner: ID!, id: ID!): Task
  }
`;
