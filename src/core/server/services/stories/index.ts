import { zip } from "lodash";
import { Db } from "mongodb";

import { StoryURLInvalidError } from "coral-server/errors";
import logger from "coral-server/logger";
import {
  countTotalActionCounts,
  mergeCommentActionCounts,
  mergeManyStoryActions,
  removeStoryActions,
} from "coral-server/models/action/comment";
import {
  mergeManyCommentStories,
  removeStoryComments,
} from "coral-server/models/comment";
import {
  calculateTotalCommentCount,
  closeStory,
  createStory,
  CreateStoryInput,
  findOrCreateStory,
  FindOrCreateStoryInput,
  findStory,
  FindStoryInput,
  mergeCommentStatusCount,
  openStory,
  removeStories,
  removeStory,
  retrieveManyStories,
  retrieveStory,
  Story,
  updateStory,
  updateStoryActionCounts,
  updateStoryCommentStatusCount,
  UpdateStoryInput,
  updateStorySettings,
  UpdateStorySettingsInput,
} from "coral-server/models/story";
import { Tenant } from "coral-server/models/tenant";
import { ScraperQueue } from "coral-server/queue/tasks/scraper";
import { scrape } from "coral-server/services/stories/scraper";

import { AugmentedRedis } from "../redis";
import { isURLPermitted } from "../tenant/url";

export type FindStory = FindStoryInput;

export async function find(mongo: Db, tenant: Tenant, input: FindStory) {
  // If the URL is provided, and the url is not on a allowed domain, then refuse
  // to create the Asset.
  if (input.url && !isURLPermitted(tenant, input.url)) {
    throw new StoryURLInvalidError({
      storyURL: input.url,
      allowedDomains: tenant.allowedDomains,
    });
  }

  return findStory(mongo, tenant.id, input);
}

export type FindOrCreateStory = FindOrCreateStoryInput;

export async function findOrCreate(
  mongo: Db,
  tenant: Tenant,
  input: FindOrCreateStory,
  scraper: ScraperQueue,
  now = new Date()
) {
  // If the URL is provided, and the url is not on a allowed domain, then refuse
  // to create the Asset.
  if (input.url && !isURLPermitted(tenant, input.url)) {
    throw new StoryURLInvalidError({
      storyURL: input.url,
      allowedDomains: tenant.allowedDomains,
    });
  }

  const story = await findOrCreateStory(mongo, tenant.id, input, now);
  if (!story) {
    return null;
  }

  if (tenant.stories.scraping.enabled && !story.metadata && !story.scrapedAt) {
    // If the scraper has not scraped this story, and we have no metadata, we
    // need to scrape it now!
    await scraper.add({
      storyID: story.id,
      storyURL: story.url,
      tenantID: tenant.id,
    });
  }

  return story;
}

export async function remove(
  mongo: Db,
  tenant: Tenant,
  storyID: string,
  includeComments: boolean = false
) {
  // Create a logger for this function.
  const log = logger.child({
    storyID,
    includeComments,
  });

  log.debug("starting to remove story");

  // Get the story so we can see if there are associated comments.
  const story = await retrieveStory(mongo, tenant.id, storyID);
  if (!story) {
    // No story was found!
    log.warn("attempted to remove story that wasn't found");
    return null;
  }

  if (includeComments) {
    // Remove the actions associated with the comments we just removed.
    const { deletedCount: removedActions } = await removeStoryActions(
      mongo,
      tenant.id,
      story.id
    );

    log.debug({ removedActions }, "removed actions while deleting story");

    // Remove the comments for the story.
    const { deletedCount: removedComments } = await removeStoryComments(
      mongo,
      tenant.id,
      story.id
    );

    log.debug({ removedComments }, "removed comments while deleting story");
  } else if (calculateTotalCommentCount(story.commentCounts.status) > 0) {
    log.warn(
      "attempted to remove story that has linked comments without consent for deleting comments"
    );

    // TODO: (wyattjoh) improve error
    throw new Error("asset has comments, cannot remove");
  }

  const removedStory = await removeStory(mongo, tenant.id, story.id);
  if (!removedStory) {
    // Story was already removed.
    // TODO: evaluate use of transaction here.
    return null;
  }

  log.debug("removed story");

  return removedStory;
}

export type CreateStory = CreateStoryInput;

export async function create(
  mongo: Db,
  tenant: Tenant,
  storyID: string,
  storyURL: string,
  { metadata, closedAt }: CreateStory,
  now = new Date()
) {
  // Ensure that the given URL is allowed.
  if (!isURLPermitted(tenant, storyURL)) {
    throw new StoryURLInvalidError({
      storyURL,
      allowedDomains: tenant.allowedDomains,
    });
  }

  // Construct the input payload.
  const input: CreateStoryInput = { metadata, closedAt };
  if (metadata) {
    input.scrapedAt = now;
  }

  // Create the story in the database.
  let newStory = await createStory(
    mongo,
    tenant.id,
    storyID,
    storyURL,
    input,
    now
  );
  if (!metadata && tenant.stories.scraping.enabled) {
    // If the scraper has not scraped this story and story metadata was not
    // provided, we need to scrape it now!
    newStory = await scrape(mongo, tenant.id, newStory.id, storyURL);
  }

  return newStory;
}

export type UpdateStory = UpdateStoryInput;

export async function update(
  mongo: Db,
  tenant: Tenant,
  storyID: string,
  input: UpdateStory,
  now = new Date()
) {
  // Ensure that the given URL is allowed.
  if (input.url && !isURLPermitted(tenant, input.url)) {
    throw new StoryURLInvalidError({
      storyURL: input.url,
      allowedDomains: tenant.allowedDomains,
    });
  }

  return updateStory(mongo, tenant.id, storyID, input, now);
}
export type UpdateStorySettings = UpdateStorySettingsInput;

export async function updateSettings(
  mongo: Db,
  tenant: Tenant,
  storyID: string,
  input: UpdateStorySettings,
  now = new Date()
) {
  return updateStorySettings(mongo, tenant.id, storyID, input, now);
}

export async function open(
  mongo: Db,
  tenant: Tenant,
  storyID: string,
  now = new Date()
) {
  return openStory(mongo, tenant.id, storyID, now);
}

export async function close(
  mongo: Db,
  tenant: Tenant,
  storyID: string,
  now = new Date()
) {
  return closeStory(mongo, tenant.id, storyID, now);
}

export async function merge(
  mongo: Db,
  redis: AugmentedRedis,
  tenant: Tenant,
  destinationID: string,
  sourceIDs: string[]
) {
  // Create a logger for this operation.
  const log = logger.child({
    destinationID,
    sourceIDs,
  });

  if (sourceIDs.length === 0) {
    log.warn("cannot merge from 0 stories");
    return null;
  }

  // Get the stories referenced.
  const storyIDs = [destinationID, ...sourceIDs];
  const stories = await retrieveManyStories(mongo, tenant.id, storyIDs);

  // Ensure that these are all defined.
  if (
    zip(storyIDs, stories).some(([storyID, story]) => {
      if (!story) {
        log.warn(
          { storyID },
          "story that was going to be merged was not found"
        );
        return true;
      }

      return false;
    })
  ) {
    return null;
  }

  // Move all the comment's from the source stories over to the destination
  // story.
  const { modifiedCount: updatedComments } = await mergeManyCommentStories(
    mongo,
    tenant.id,
    destinationID,
    sourceIDs
  );

  log.debug({ updatedComments }, "updated comments while merging stories");

  // Update all the action's that referenced the old story to reference the new
  // story.
  const { modifiedCount: updatedActions } = await mergeManyStoryActions(
    mongo,
    tenant.id,
    destinationID,
    sourceIDs
  );

  log.debug({ updatedActions }, "updated actions while merging stories");

  // Merge the comment and action counts for all the source stories.
  const [, ...sourceStories] = stories;

  let destinationStory = await updateStoryCommentStatusCount(
    mongo,
    redis,
    tenant.id,
    destinationID,
    mergeCommentStatusCount(
      // We perform the type assertion here because above, we already verified
      // that none of the stories are null.
      (sourceStories as Story[]).map(({ commentCounts: { status } }) => status)
    )
  );

  const mergedActionCounts = mergeCommentActionCounts(
    // We perform the type assertion here because above, we already verified
    // that none of the stories are null.
    ...(sourceStories as Story[]).map(({ commentCounts: { action } }) => action)
  );
  if (countTotalActionCounts(mergedActionCounts) > 0) {
    destinationStory = await updateStoryActionCounts(
      mongo,
      redis,
      tenant.id,
      destinationID,
      mergedActionCounts
    );
  }

  if (!destinationStory) {
    log.warn("destination story cannot be updated with new comment counts");
    return null;
  }

  log.debug(
    { commentCounts: destinationStory.commentCounts.status },
    "updated destination story with new comment counts"
  );

  // Remove the stories from MongoDB.
  const { deletedCount } = await removeStories(mongo, tenant.id, sourceIDs);

  log.debug({ deletedStories: deletedCount }, "deleted source stories");

  // Return the story that had the other stories merged into.
  return destinationStory;
}
