import { graphql } from "react-relay";
import { Environment, RecordSourceSelectorProxy } from "relay-runtime";

import {
  commitMutationPromiseNormalized,
  createMutation,
  MutationInput,
} from "coral-framework/lib/relay";
import { GQLCOMMENT_STATUS } from "coral-framework/schema";
import { RejectCommentMutation as MutationTypes } from "coral-stream/__generated__/RejectCommentMutation.graphql";

let clientMutationId = 0;

function decrementCount(store: RecordSourceSelectorProxy, storyID: string) {
  const storyRecord = store.get(storyID);
  if (!storyRecord) {
    return;
  }
  const commentCountsRecord = storyRecord.getLinkedRecord("commentCounts");
  if (!commentCountsRecord) {
    return;
  }
  const tagsRecord = commentCountsRecord.getLinkedRecord("tags");
  if (tagsRecord) {
    tagsRecord.setValue(tagsRecord.getValue("FEATURED") - 1, "FEATURED");
  }
}

const RejectCommentMutation = createMutation(
  "rejectComment",
  (
    environment: Environment,
    input: MutationInput<MutationTypes> & { storyID: string }
  ) =>
    commitMutationPromiseNormalized<MutationTypes>(environment, {
      mutation: graphql`
        mutation RejectCommentMutation($input: RejectCommentInput!) {
          rejectComment(input: $input) {
            comment {
              status
              tags {
                code
              }
            }
            clientMutationId
          }
        }
      `,
      optimisticResponse: {
        rejectComment: {
          comment: {
            id: input.commentID,
            status: GQLCOMMENT_STATUS.REJECTED,
          },
          clientMutationId: clientMutationId.toString(),
        },
      },
      variables: {
        input: {
          commentID: input.commentID,
          commentRevisionID: input.commentRevisionID,
          clientMutationId: (clientMutationId++).toString(),
        },
      },
      updater: store => {
        store.get(input.commentID)!.setValue("REJECT", "lastViewerAction");

        if (input.storyID) {
          decrementCount(store, input.storyID);
        }
      },
    })
);

export default RejectCommentMutation;
