import { ReactTestRenderer } from "react-test-renderer";
import sinon from "sinon";
import timekeeper from "timekeeper";

import { timeout } from "talk-common/utils";
import { createSinonStub } from "talk-framework/testHelpers";

import { baseComment, settings, stories, users } from "../fixtures";
import create from "./create";

let testRenderer: ReactTestRenderer;
beforeEach(() => {
  const resolvers = {
    Query: {
      settings: sinon.stub().returns(settings),
      me: sinon.stub().returns(users[0]),
      story: createSinonStub(
        s => s.throws(),
        s =>
          s
            .withArgs(undefined, { id: stories[0].id, url: null })
            .returns(stories[0])
      ),
    },
    Mutation: {
      createCommentReply: createSinonStub(
        s => s.throws(),
        s =>
          s
            .withArgs(undefined, {
              input: {
                storyID: stories[0].id,
                parentID: stories[0].comments.edges[0].node.id,
                parentRevisionID: stories[0].comments.edges[0].node.revision.id,
                body: "<strong>Hello world!</strong>",
                clientMutationId: "0",
              },
            })
            .returns({
              edge: {
                cursor: null,
                node: {
                  ...baseComment,
                  id: "comment-x",
                  author: users[0],
                  body: "<strong>Hello world! (from server)</strong>",
                },
              },
              clientMutationId: "0",
            })
      ),
    },
  };

  ({ testRenderer } = create({
    // Set this to true, to see graphql responses.
    logNetwork: false,
    resolvers,
    initLocalState: localRecord => {
      localRecord.setValue(stories[0].id, "storyID");
      localRecord.setValue(true, "loggedIn");
    },
  }));
});

it("renders comment stream", async () => {
  // Wait for loading.
  await timeout();
  expect(testRenderer.toJSON()).toMatchSnapshot();
});

it("post a reply", async () => {
  // Wait for loading.
  await timeout();

  // Open reply form.
  testRenderer.root
    .findByProps({ id: "comments-commentContainer-replyButton-comment-0" })
    .props.onClick();

  await timeout();
  expect(testRenderer.toJSON()).toMatchSnapshot("open reply form");

  // Write reply .
  testRenderer.root
    .findByProps({ inputId: "comments-replyCommentForm-rte-comment-0" })
    .props.onChange({ html: "<strong>Hello world!</strong>" });

  timekeeper.freeze(new Date(baseComment.createdAt));
  testRenderer.root
    .findByProps({ id: "comments-replyCommentForm-form-comment-0" })
    .props.onSubmit();
  // Test optimistic response.
  expect(testRenderer.toJSON()).toMatchSnapshot("optimistic response");
  timekeeper.reset();

  // Wait for loading.
  await timeout();

  // Test after server response.
  expect(testRenderer.toJSON()).toMatchSnapshot("server response");
});