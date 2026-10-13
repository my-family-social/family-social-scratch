import db from "@/components/db/drizzle";
import { and, asc, desc, eq, ilike, inArray, ne, or } from "drizzle-orm";

import {
  member,
  discussThread,
  pwaMutationRequest,
  recipe,
  recipeComment,
  recipeLike,
  recipeTag,
  recipeTagReference,
  recipeTemplate,
  recipeTerm,
} from "../schema/family-social-schema-tables";
import {
  FoodiesTemplateManagementDataReturn,
  FoodiesTemplateRecord,
  FoodiesHomePageDataReturn,
  FoodiesRecipe,
  FoodiesRecipeDetail,
  GetFoodiesRecipeReturn,
  RecipeComment,
  RecipeTagOption,
  RecipeTagType,
  RecipeTemplateOption,
  SaveFoodiesRecipeInput,
  SaveFoodiesRecipeReturn,
  SaveFoodiesTemplateInput,
  SaveFoodiesTemplateReturn,
  ToggleRecipeLikeReturn,
  AddRecipeCommentReturn,
  GetFoodiesRecipeDetailReturn,
  RecipeTerm,
  GetRecipeTermReturn,
  RecipeTermsReturn,
  SaveRecipeTermInput,
  SaveRecipeTermReturn,
} from "../types/recipes";
import {
  createTextTipTapDocument,
  createEmptyTipTapDocument,
  isTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
  serializeTipTapDocument,
} from "../types/poem-term-validation";
import {
  createFamilyActivityRecord,
  createFamilyReactionActivityRecord,
  FAMILY_ACTIVITY_ACTION_TYPES,
} from "./queries-family-activity";
import { loadDiscussionThreadSummariesByTargetIds } from './queries-discuss-threads';
import { logDbQueryError } from "./db-error-logger";
import { canViewTemplate } from "./template-access";

const SUPPORTED_RECIPE_TAG_TYPES: RecipeTagType[] = [
  "cuisine",
  "course_type",
  "cooking_method",
  "dietary",
  "meal_time",
];
const GLOBAL_TEMPLATE_FAMILY_ID = 1;
const GLOBAL_CONTENT_OWNER_FAMILY_ID = 1;

function createSubmitterName(firstName?: string | null, lastName?: string | null) {
  const names = [firstName, lastName].filter(Boolean);

  if (names.length > 0) {
    return names.join(" ");
  }

  return "Unknown Member";
}

async function isViewerFounderForDrafts(familyId: number, viewerMemberId?: number): Promise<boolean> {
  if (!viewerMemberId) {
    return false;
  }

  const viewer = await db
    .select({
      id: member.id,
      isFounder: member.isFounder,
    })
    .from(member)
    .where(and(eq(member.id, viewerMemberId), eq(member.familyId, familyId)))
    .then((rows) => rows[0] ?? null);

  return Boolean(viewer?.isFounder);
}

function canViewDraftPost(
  status: string,
  ownerMemberId: number,
  viewerMemberId: number | undefined,
  viewerIsFounder: boolean
) {
  if (status !== "draft") {
    return true;
  }

  return ownerMemberId === viewerMemberId || viewerIsFounder;
}

function createDefaultRecipeTemplateJson() {
  return serializeTipTapDocument({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "General" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Main Ingredients" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Spices" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Preparation" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Cooking" }] },
      { type: "paragraph" },
    ],
  });
}

function isEmptyRecipeProTipComment(commentJson: string) {
  const normalized = commentJson.trim();

  if (!normalized || normalized === "{}") {
    return true;
  }

  const parsed = parseSerializedTipTapDocument(normalized);

  if (!parsed.success) {
    return false;
  }

  return isTipTapDocumentEmpty(parsed.content);
}

async function ensureGlobalRecipeTemplate(
  memberId: number,
  canManageGlobalTemplate: boolean
): Promise<RecipeTemplateOption | null> {
  const [existingTemplate] = await db
    .select({
      id: recipeTemplate.id,
      templateName: recipeTemplate.templateName,
      isGlobalTemplate: recipeTemplate.isGlobalTemplate,
      status: recipeTemplate.status,
      templateJson: recipeTemplate.templateJson,
      memberId: recipeTemplate.memberId,
      familyId: recipeTemplate.familyId,
    })
    .from(recipeTemplate)
    .where(and(eq(recipeTemplate.isGlobalTemplate, true), eq(recipeTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)))
    .orderBy(asc(recipeTemplate.id));

  if (existingTemplate) {
    return {
      id: existingTemplate.id,
      templateName: existingTemplate.templateName,
      isGlobalTemplate: existingTemplate.isGlobalTemplate,
      status: existingTemplate.status,
      templateJson: existingTemplate.templateJson,
      memberId: existingTemplate.memberId,
      familyId: existingTemplate.familyId,
      label: existingTemplate.templateName,
    };
  }

  if (!canManageGlobalTemplate) {
    return null;
  }

  const defaultTemplateJson = createDefaultRecipeTemplateJson();
  const [createdTemplate] = await db
    .insert(recipeTemplate)
    .values({
      templateName: `__global-${GLOBAL_TEMPLATE_FAMILY_ID}`,
      isGlobalTemplate: true,
      status: "published",
      templateJson: defaultTemplateJson,
      memberId,
      familyId: GLOBAL_TEMPLATE_FAMILY_ID,
    })
    .returning();

  return {
    id: createdTemplate.id,
    templateName: createdTemplate.templateName,
    isGlobalTemplate: createdTemplate.isGlobalTemplate,
    status: createdTemplate.status,
    templateJson: createdTemplate.templateJson,
    memberId: createdTemplate.memberId,
    familyId: createdTemplate.familyId,
    label: createdTemplate.templateName,
  };
}

async function loadRecipeTagOptions(): Promise<RecipeTagOption[]> {
  const result = await db
    .select({
      id: recipeTagReference.id,
      tagName: recipeTagReference.tagName,
      tagDesc: recipeTagReference.tagDesc,
      tagType: recipeTagReference.tagType,
      status: recipeTagReference.status,
      seqNo: recipeTagReference.seqNo,
    })
    .from(recipeTagReference)
    .where(inArray(recipeTagReference.tagType, SUPPORTED_RECIPE_TAG_TYPES))
    .orderBy(asc(recipeTagReference.tagType), asc(recipeTagReference.seqNo), asc(recipeTagReference.tagName));

  return result.map((row) => ({
    id: row.id,
    tagName: row.tagName,
    tagDesc: row.tagDesc,
    tagType: row.tagType as RecipeTagType,
    status: row.status,
    seqNo: row.seqNo,
  }));
}

async function loadRecipeTemplates(
  familyId: number,
  memberId: number,
  options: {
    includeDraft: boolean;
    includeGlobal: boolean;
    ensureGlobalTemplate?: boolean;
  }
): Promise<RecipeTemplateOption[]> {
  const { includeDraft, includeGlobal, ensureGlobalTemplate = false } = options;
  const isTemplateDebug = process.env.NODE_ENV !== "production";
  const canManageGlobalTemplate = familyId === GLOBAL_TEMPLATE_FAMILY_ID && ensureGlobalTemplate;
  const defaultTemplate = includeGlobal && ensureGlobalTemplate
    ? await ensureGlobalRecipeTemplate(memberId, canManageGlobalTemplate)
    : null;
  const whereCondition = and(
    includeGlobal
      ? or(
        and(eq(recipeTemplate.isGlobalTemplate, true), eq(recipeTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)),
        and(
          eq(recipeTemplate.isGlobalTemplate, false),
          eq(recipeTemplate.familyId, familyId)
        )
      )
      : and(
        eq(recipeTemplate.isGlobalTemplate, false),
        eq(recipeTemplate.familyId, familyId)
      ),
    includeDraft
      ? undefined
      : includeGlobal
        ? or(eq(recipeTemplate.status, "published"), eq(recipeTemplate.isGlobalTemplate, true))
        : eq(recipeTemplate.status, "published"),
    includeGlobal ? undefined : eq(recipeTemplate.isGlobalTemplate, false)
  );

  const templateRows = await db
    .select({
      id: recipeTemplate.id,
      templateName: recipeTemplate.templateName,
      isGlobalTemplate: recipeTemplate.isGlobalTemplate,
      status: recipeTemplate.status,
      templateJson: recipeTemplate.templateJson,
      memberId: recipeTemplate.memberId,
      familyId: recipeTemplate.familyId,
    })
    .from(recipeTemplate)
    .where(whereCondition)
    .orderBy(desc(recipeTemplate.isGlobalTemplate), asc(recipeTemplate.templateName));

  // if (isTemplateDebug) {
  //   console.log("[Foodies][loadRecipeTemplates] input", {
  //     familyId,
  //     memberId,
  //     includeDraft,
  //     includeGlobal,
  //     ensureGlobalTemplate,
  //   });
  //   console.log(
  //     "[Foodies][loadRecipeTemplates] rows",
  //     templateRows.map((template) => ({
  //       id: template.id,
  //       templateName: template.templateName,
  //       isGlobalTemplate: template.isGlobalTemplate,
  //       status: template.status,
  //       hasTemplateJson: Boolean(template.templateJson && template.templateJson.trim().length > 0),
  //       templateJsonLength: template.templateJson?.length ?? 0,
  //     }))
  //   );
  // }

  const templateMap = new Map<number, RecipeTemplateOption>();

  if (defaultTemplate) {
    templateMap.set(defaultTemplate.id, defaultTemplate);
  }

  for (const row of templateRows.filter((template) => canViewTemplate(template, familyId, memberId))) {
    templateMap.set(row.id, {
      id: row.id,
      templateName: row.templateName,
      isGlobalTemplate: row.isGlobalTemplate,
      status: row.status,
      templateJson: row.templateJson,
      memberId: row.memberId,
      familyId: row.familyId,
      label: row.templateName,
    });
  }

  const finalTemplates = Array.from(templateMap.values()).sort((leftTemplate, rightTemplate) => {
    if (leftTemplate.isGlobalTemplate !== rightTemplate.isGlobalTemplate) {
      return leftTemplate.isGlobalTemplate ? -1 : 1;
    }

    return leftTemplate.label.localeCompare(rightTemplate.label);
  });

  // if (isTemplateDebug) {
  //   console.log(
  //     "[Foodies][loadRecipeTemplates] final",
  //     finalTemplates.map((template) => ({
  //       id: template.id,
  //       label: template.label,
  //       isGlobalTemplate: template.isGlobalTemplate,
  //       status: template.status,
  //       hasTemplateJson: Boolean(template.templateJson && template.templateJson.trim().length > 0),
  //       templateJsonLength: template.templateJson?.length ?? 0,
  //     }))
  //   );
  // }

  return finalTemplates;
}

async function loadFoodiesTemplateManagementRecords(
  familyId: number,
  actorMemberId: number,
  actorIsAdmin: boolean,
  actorIsFounder = false
): Promise<FoodiesTemplateRecord[]> {
  const canManageGlobalTemplate = actorIsAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;

  if (canManageGlobalTemplate) {
    await ensureGlobalRecipeTemplate(actorMemberId, true);
  }

  const whereCondition = or(
    and(eq(recipeTemplate.isGlobalTemplate, true), eq(recipeTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)),
    and(
      eq(recipeTemplate.isGlobalTemplate, false),
      eq(recipeTemplate.familyId, familyId)
    )
  );

  const templateRows = await db
    .select({
      id: recipeTemplate.id,
      templateName: recipeTemplate.templateName,
      status: recipeTemplate.status,
      isGlobalTemplate: recipeTemplate.isGlobalTemplate,
      templateJson: recipeTemplate.templateJson,
      memberId: recipeTemplate.memberId,
      familyId: recipeTemplate.familyId,
      updatedAt: recipeTemplate.updatedAt,
    })
    .from(recipeTemplate)
    .where(whereCondition)
    .orderBy(desc(recipeTemplate.updatedAt), asc(recipeTemplate.templateName));

  const visibleTemplateRows = templateRows.filter((template) => canViewTemplate(template, familyId, actorMemberId));
  const memberIds = [...new Set(visibleTemplateRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))] as number[];
  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));

  return visibleTemplateRows.map((row) => {
    const canEdit = row.isGlobalTemplate
      ? canManageGlobalTemplate
      : row.memberId === actorMemberId || actorIsFounder;

    return {
      id: row.id,
      templateName: row.templateName,
      status: row.status,
      isGlobalTemplate: row.isGlobalTemplate,
      templateJson: row.templateJson,
      memberId: row.memberId,
      familyId: row.familyId,
      updatedAt: row.updatedAt ?? new Date(),
      ownerName: row.isGlobalTemplate
        ? "Global Template"
        : memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
      memberImageUrl: row.isGlobalTemplate ? null : memberImageUrlById.get(row.memberId ?? 0) ?? null,
      canEdit,
    };
  });
}

async function loadFoodiesRecipes(familyId: number, viewerMemberId?: number): Promise<FoodiesRecipe[]> {
  const recipeRows = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.familyId, familyId), ne(recipe.status, "template")))
    .orderBy(desc(recipe.updatedAt), asc(recipe.recipeTitle));

  if (!recipeRows || recipeRows.length === 0) {
    return [];
  }

  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);
  const visibleRecipeRows = recipeRows.filter((row) => canViewDraftPost(row.status, row.memberId, viewerMemberId, viewerIsFounder));

  if (visibleRecipeRows.length === 0) {
    return [];
  }

  const recipeIds = visibleRecipeRows.map((row) => row.id);

  const [commentRows, likeRows, tagRows, discussionThreadsByRecipeId] = await Promise.all([
    db
      .select({
        id: recipeComment.id,
        recipeId: recipeComment.recipeId,
        isRecipeProTip: recipeComment.isRecipeProTip,
      })
      .from(recipeComment)
      .where(inArray(recipeComment.recipeId, recipeIds)),
    db
      .select({
        recipeId: recipeLike.recipeId,
        memberId: recipeLike.memberId,
        likenessDegree: recipeLike.likenessDegree,
      })
      .from(recipeLike)
      .where(inArray(recipeLike.recipeId, recipeIds)),
    db
      .select({
        recipeId: recipeTag.recipeId,
        tagId: recipeTag.tagId,
        tagName: recipeTagReference.tagName,
        tagType: recipeTagReference.tagType,
      })
      .from(recipeTag)
      .innerJoin(recipeTagReference, eq(recipeTagReference.id, recipeTag.tagId))
      .where(inArray(recipeTag.recipeId, recipeIds)),
    loadDiscussionThreadSummariesByTargetIds(familyId, 'recipe', recipeIds),
  ]);

  const memberIds = [...new Set(visibleRecipeRows.map((row) => row.memberId))];
  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));

  const commentCountByRecipeId = new Map<number, number>();
  const noRatingByRecipeId = new Map<number, number>();
  const thumbsUpByRecipeId = new Map<number, number>();
  const loveByRecipeId = new Map<number, number>();
  const thumbsUpMemberNamesByRecipeId = new Map<number, string[]>();
  const loveMemberNamesByRecipeId = new Map<number, string[]>();
  const submitterLikeByRecipeId = new Map<number, number>();
  const tagIdsByRecipeId = new Map<number, number[]>();
  const tagNamesByTypeByRecipeId = new Map<number, Partial<Record<RecipeTagType, string[]>>>();

  for (const commentRow of commentRows) {
    if (commentRow.isRecipeProTip) {
      continue;
    }

    commentCountByRecipeId.set(commentRow.recipeId, (commentCountByRecipeId.get(commentRow.recipeId) ?? 0) + 1);
  }

  for (const likeRow of likeRows) {
    const recipeRow = visibleRecipeRows.find((row) => row.id === likeRow.recipeId);

    if (recipeRow && likeRow.memberId === recipeRow.memberId) {
      submitterLikeByRecipeId.set(likeRow.recipeId, likeRow.likenessDegree);
      continue;
    }

    if (likeRow.likenessDegree === 1) {
      thumbsUpByRecipeId.set(likeRow.recipeId, (thumbsUpByRecipeId.get(likeRow.recipeId) ?? 0) + 1);
      const memberName = memberNameById.get(likeRow.memberId) ?? `Member #${likeRow.memberId}`;
      const memberNames = thumbsUpMemberNamesByRecipeId.get(likeRow.recipeId) ?? [];
      memberNames.push(memberName);
      thumbsUpMemberNamesByRecipeId.set(likeRow.recipeId, memberNames);
      continue;
    }

    if (likeRow.likenessDegree === 2) {
      loveByRecipeId.set(likeRow.recipeId, (loveByRecipeId.get(likeRow.recipeId) ?? 0) + 1);
      const memberName = memberNameById.get(likeRow.memberId) ?? `Member #${likeRow.memberId}`;
      const memberNames = loveMemberNamesByRecipeId.get(likeRow.recipeId) ?? [];
      memberNames.push(memberName);
      loveMemberNamesByRecipeId.set(likeRow.recipeId, memberNames);
      continue;
    }

    if (likeRow.likenessDegree === -1) {
      noRatingByRecipeId.set(likeRow.recipeId, (noRatingByRecipeId.get(likeRow.recipeId) ?? 0) + 1);
    }
  }

  for (const tagRow of tagRows) {
    const existingTagIds = tagIdsByRecipeId.get(tagRow.recipeId) ?? [];
    existingTagIds.push(tagRow.tagId);
    tagIdsByRecipeId.set(tagRow.recipeId, existingTagIds);

    const tagType = tagRow.tagType as RecipeTagType;
    const byType = tagNamesByTypeByRecipeId.get(tagRow.recipeId) ?? {};
    const currentNames = byType[tagType] ?? [];
    byType[tagType] = [...currentNames, tagRow.tagName];
    tagNamesByTypeByRecipeId.set(tagRow.recipeId, byType);
  }

  return visibleRecipeRows.map((row) => ({
    id: row.id,
    recipeTitle: row.recipeTitle,
    recipeShortSummary: row.recipeShortSummary,
    recipeJson: row.recipeJson,
    status: row.status,
    recipeImageUrl: row.recipeImageUrl,
    prepTimeMins: row.prepTimeMins,
    cookTimeMins: row.cookTimeMins,
    updatedAt: row.updatedAt ?? new Date(),
    memberId: row.memberId,
    familyId: row.familyId,
    submitterName: memberNameById.get(row.memberId) ?? `Member #${row.memberId}`,
    submitterImageUrl: memberImageUrlById.get(row.memberId) ?? null,
    submitterLikenessDegree: submitterLikeByRecipeId.get(row.id) ?? null,
    commentCount: commentCountByRecipeId.get(row.id) ?? 0,
    noRatingCount: noRatingByRecipeId.get(row.id) ?? 0,
    thumbsUpCount: thumbsUpByRecipeId.get(row.id) ?? 0,
    loveCount: loveByRecipeId.get(row.id) ?? 0,
    thumbsUpMemberNames: (thumbsUpMemberNamesByRecipeId.get(row.id) ?? []).sort((leftName, rightName) => leftName.localeCompare(rightName)),
    loveMemberNames: (loveMemberNamesByRecipeId.get(row.id) ?? []).sort((leftName, rightName) => leftName.localeCompare(rightName)),
    selectedTagIds: tagIdsByRecipeId.get(row.id) ?? [],
    tagNamesByType: tagNamesByTypeByRecipeId.get(row.id) ?? {},
    templateId: row.templateId ?? null,
    discussionThreads: discussionThreadsByRecipeId.get(row.id) ?? [],
    hasDiscussionThread: (discussionThreadsByRecipeId.get(row.id) ?? []).length > 0,
  }));
}

export async function getFoodiesRecipeById(
  familyId: number,
  recipeId: number,
  viewerMemberId?: number
): Promise<GetFoodiesRecipeReturn> {
  const recipes = await loadFoodiesRecipes(familyId, viewerMemberId);
  const selectedRecipe = recipes.find((recipeRecord) => recipeRecord.id === recipeId);

  if (!selectedRecipe) {
    return {
      success: false,
      message: `No recipe was found for id: ${ recipeId }`,
    };
  }

  return {
    success: true,
    recipe: selectedRecipe,
  };
}

export async function getFoodiesHomePageData(
  familyId: number,
  memberId: number,
  isAdmin = false
): Promise<FoodiesHomePageDataReturn> {
  try {
    const canManageGlobalTemplate = isAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const isTemplateDebug = process.env.NODE_ENV !== "production";
    const [recipes, recipeTags, recipeTemplates] = await Promise.all([
      loadFoodiesRecipes(familyId, memberId),
      loadRecipeTagOptions(),
      loadRecipeTemplates(familyId, memberId, {
        includeDraft: false,
        includeGlobal: true,
        ensureGlobalTemplate: canManageGlobalTemplate,
      }),
    ]);

    // if (isTemplateDebug) {
    //   console.log(
    //     "[Foodies][getFoodiesHomePageData] recipeTemplates",
    //     recipeTemplates.map((template) => ({
    //       id: template.id,
    //       label: template.label,
    //       isGlobalTemplate: template.isGlobalTemplate,
    //       status: template.status,
    //       hasTemplateJson: Boolean(template.templateJson && template.templateJson.trim().length > 0),
    //       templateJsonLength: template.templateJson?.length ?? 0,
    //     }))
    //   );
    // }

    return {
      success: true,
      recipes,
      recipeTags,
      recipeTemplates,
    };
  } catch (error) {
    logDbQueryError("foodies.getFoodiesHomePageData", error, { familyId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading foodies home page data",
    };
  }
}

export async function getFoodiesTemplateManagementData(
  familyId: number,
  memberId: number,
  isAdmin: boolean,
  isFounder = false
): Promise<FoodiesTemplateManagementDataReturn> {
  try {
    const canManageGlobalTemplate = isAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const templates = await loadFoodiesTemplateManagementRecords(familyId, memberId, canManageGlobalTemplate, isFounder);

    return {
      success: true,
      templates,
    };
  } catch (error) {
    logDbQueryError("foodies.getFoodiesTemplateManagementData", error, { familyId, memberId, isAdmin });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading recipe templates",
    };
  }
}

export async function saveFoodiesRecipe(
  input: SaveFoodiesRecipeInput,
  actor: {
    familyId: number;
    memberId: number;
    isAdmin?: boolean;
    isFounder?: boolean;
  }
): Promise<SaveFoodiesRecipeReturn> {
  const canManageGlobalTemplate = (actor.isAdmin ?? false) && actor.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
  const normalizedTitle = input.recipeTitle.trim();
  const normalizedSummary = input.recipeShortSummary.trim();
  const normalizedStatus = input.status.trim() || "draft";
  const normalizedPrepTime = Number.isFinite(input.prepTimeMins)
    ? Math.max(0, Math.round(input.prepTimeMins))
    : 0;
  const normalizedCookTime = Number.isFinite(input.cookTimeMins)
    ? Math.max(0, Math.round(input.cookTimeMins))
    : 0;
  const uniqueTagIds = [...new Set(input.selectedTagIds)];

  if (!normalizedTitle) {
    return {
      success: false,
      message: "Enter a recipe title before saving.",
    };
  }

  const existingRecipe = input.id
    ? await db
      .select()
      .from(recipe)
      .where(and(eq(recipe.id, input.id), eq(recipe.familyId, actor.familyId), ne(recipe.status, "template")))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingRecipe) {
    return {
      success: false,
      message: `No recipe was found for id: ${ input.id }`,
    };
  }

  if (existingRecipe && existingRecipe.memberId !== actor.memberId) {
    // Allow founders to archive/unarchive recipes, but not edit other fields
    const isFounderModifyingArchiveStatus = actor.isFounder && 
      (input.status === 'archived' || (existingRecipe.status === 'archived' && input.status === 'published'));
    
    if (!isFounderModifyingArchiveStatus) {
      return {
        success: false,
        message: "Only the member who created this recipe can edit it.",
      };
    }

    // For founders doing archive/unarchive, only update status field
    try {
      const [updatedRecipe] = await db
        .update(recipe)
        .set({ status: input.status })
        .where(eq(recipe.id, existingRecipe.id))
        .returning();

      if (!updatedRecipe) {
        return {
          success: false,
          message: `Failed to archive/unarchive recipe with id: ${input.id}`,
        };
      }

      // Load the full updated recipe to return
      const recipes = await loadFoodiesRecipes(actor.familyId, actor.memberId);
      const fullUpdatedRecipe = recipes.find((r) => r.id === updatedRecipe.id);

      if (!fullUpdatedRecipe) {
        return {
          success: false,
          message: `Failed to load updated recipe with id: ${input.id}`,
        };
      }

      return {
        success: true,
        recipe: fullUpdatedRecipe,
        message: updatedRecipe.status === "archived" ? "Recipe archived." : "Recipe unarchived.",
      };
    } catch (error) {
      logDbQueryError("foodies.saveFoodiesRecipe.archiveToggle", error, {
        recipeId: input.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
        status: input.status,
      });
      return {
        success: false,
        message: "An error occurred while archiving the recipe.",
      };
    }
  }

  const duplicateRows = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(
      input.id
        ? and(eq(recipe.familyId, actor.familyId), ilike(recipe.recipeTitle, normalizedTitle), ne(recipe.id, input.id))
        : and(eq(recipe.familyId, actor.familyId), ilike(recipe.recipeTitle, normalizedTitle))
    );

  if (duplicateRows.length > 0) {
    return {
      success: false,
      message: "A recipe with this title already exists in your family.",
    };
  }

  const templates = await loadRecipeTemplates(actor.familyId, actor.memberId, {
    includeDraft: false,
    includeGlobal: true,
    ensureGlobalTemplate: canManageGlobalTemplate,
  });
  const selectedTemplate = templates.find((template) => template.id === input.templateId);

  if (!selectedTemplate) {
    return {
      success: false,
      message: "Select a valid recipe template before saving.",
    };
  }

  if (!normalizedSummary) {
    return {
      success: false,
      message: "Enter a short summary before saving.",
    };
  }

  if (!input.recipeImageUrl?.trim()) {
    return {
      success: false,
      message: "Upload a recipe photo before saving.",
    };
  }

  if (uniqueTagIds.length === 0) {
    return {
      success: false,
      message: "Select at least one recipe category before saving.",
    };
  }

  const incomingRecipeJson = input.recipeJson.trim();
  const parsedRecipeJson = incomingRecipeJson
    ? parseSerializedTipTapDocument(incomingRecipeJson)
    : { success: true as const, content: createEmptyTipTapDocument() };

  if (!parsedRecipeJson.success) {
    return {
      success: false,
      message: parsedRecipeJson.message,
    };
  }

  const recipeJsonToSave = serializeTipTapDocument(parsedRecipeJson.content);
  const incomingRecipeProTipsJson = input.recipeProTipsJson?.trim() ?? "";
  const parsedRecipeProTipsJson = incomingRecipeProTipsJson
    ? parseSerializedTipTapDocument(incomingRecipeProTipsJson)
    : { success: true as const, content: createEmptyTipTapDocument() };

  if (!parsedRecipeProTipsJson.success) {
    return {
      success: false,
      message: parsedRecipeProTipsJson.message,
    };
  }

  const recipeProTipsJsonToSave = serializeTipTapDocument(parsedRecipeProTipsJson.content);
  const hasRecipeProTips = !isTipTapDocumentEmpty(parsedRecipeProTipsJson.content);

  if (!hasRecipeProTips) {
    return {
      success: false,
      message: "Add content to the Pro-Tips section before saving.",
    };
  }

  const validTags = await db
    .select({ id: recipeTagReference.id })
    .from(recipeTagReference)
    .where(inArray(recipeTagReference.id, uniqueTagIds));

  if (validTags.length !== uniqueTagIds.length) {
    return {
      success: false,
      message: "One or more selected recipe tags are invalid.",
    };
  }

  let createdRecipeId: number | null = null;

  try {
    const [savedRecipe] = existingRecipe
      ? await db
        .update(recipe)
        .set({
          recipeTitle: normalizedTitle,
          recipeShortSummary: normalizedSummary,
          recipeJson: recipeJsonToSave,
          status: normalizedStatus,
          recipeImageUrl: input.recipeImageUrl ?? null,
          prepTimeMins: normalizedPrepTime,
          cookTimeMins: normalizedCookTime,
          templateId: selectedTemplate.id,
          updatedAt: new Date(),
        })
        .where(eq(recipe.id, existingRecipe.id))
        .returning()
      : await db
        .insert(recipe)
        .values({
          recipeTitle: normalizedTitle,
          recipeShortSummary: normalizedSummary,
          recipeJson: recipeJsonToSave,
          status: normalizedStatus,
          recipeImageUrl: input.recipeImageUrl ?? null,
          prepTimeMins: normalizedPrepTime,
          cookTimeMins: normalizedCookTime,
          templateId: selectedTemplate.id,
          memberId: actor.memberId,
          familyId: actor.familyId,
        })
        .returning();

    if (!existingRecipe) {
      createdRecipeId = savedRecipe.id;
    }

    if (existingRecipe) {
      await db
        .delete(recipeTag)
        .where(eq(recipeTag.recipeId, existingRecipe.id));
    }

    if (uniqueTagIds.length > 0) {
      await db
        .insert(recipeTag)
        .values(uniqueTagIds.map((tagId) => ({
          recipeId: savedRecipe.id,
          tagId,
        })));
    }

    if (!existingRecipe) {
      await db
        .insert(recipeComment)
        .values({
          recipeId: savedRecipe.id,
          memberId: actor.memberId,
          isRecipeProTip: true,
          commentJson: serializeTipTapDocument(createEmptyTipTapDocument()),
        });
    }

    const existingActorProTip = await db
      .select({
        id: recipeComment.id,
      })
      .from(recipeComment)
      .where(
        and(
          eq(recipeComment.recipeId, savedRecipe.id),
          eq(recipeComment.memberId, actor.memberId),
          eq(recipeComment.isRecipeProTip, true)
        )
      )
      .orderBy(desc(recipeComment.createdAt))
      .then((rows) => rows[0] ?? null);

    const existingActorLegacyProTip = existingActorProTip
      ? null
      : await db
        .select({
          id: recipeComment.id,
        })
        .from(recipeComment)
        .where(
          and(
            eq(recipeComment.recipeId, savedRecipe.id),
            eq(recipeComment.memberId, actor.memberId),
            eq(recipeComment.isRecipeProTip, false),
            eq(recipeComment.commentJson, recipeProTipsJsonToSave)
          )
        )
        .orderBy(desc(recipeComment.createdAt))
        .then((rows) => rows[0] ?? null);

    if (hasRecipeProTips) {
      if (existingActorProTip) {
        await db
          .update(recipeComment)
          .set({
            commentJson: recipeProTipsJsonToSave,
          })
          .where(eq(recipeComment.id, existingActorProTip.id));
      } else if (existingActorLegacyProTip) {
        await db
          .update(recipeComment)
          .set({
            isRecipeProTip: true,
            commentJson: recipeProTipsJsonToSave,
          })
          .where(eq(recipeComment.id, existingActorLegacyProTip.id));
      } else {
        await db
          .insert(recipeComment)
          .values({
            recipeId: savedRecipe.id,
            memberId: actor.memberId,
            isRecipeProTip: true,
            commentJson: recipeProTipsJsonToSave,
          });
      }
    }

    if (!existingRecipe) {
      await createFamilyActivityRecord({
        actionType: FAMILY_ACTIVITY_ACTION_TYPES.POST_CREATED,
        featureName: "The Kitchen",
        postName: normalizedTitle,
        postId: savedRecipe.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const [savedFoodiesRecipe] = await loadFoodiesRecipes(actor.familyId, actor.memberId).then((rows) => rows.filter((row) => row.id === savedRecipe.id));

    if (!savedFoodiesRecipe) {
      return {
        success: false,
        message: "Recipe was saved but could not be reloaded.",
      };
    }

    return {
      success: true,
      recipe: savedFoodiesRecipe,
      message: `Recipe \"${savedFoodiesRecipe.recipeTitle}\" saved successfully.`,
    };
  } catch (error) {
    logDbQueryError("foodies.saveFoodiesRecipe", error, {
      inputId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
      status: input.status,
    });
    if (createdRecipeId) {
      try {
        await db
          .delete(recipe)
          .where(eq(recipe.id, createdRecipeId));
      } catch {
        // Best-effort cleanup only.
      }
    }

    return {
      success: false,
      message: error instanceof Error
        ? `Failed to save recipe changes. Best-effort cleanup was attempted: ${error.message}`
        : "Failed to save recipe changes. Best-effort cleanup was attempted.",
    };
  }
}

export async function saveFoodiesTemplate(
  input: SaveFoodiesTemplateInput,
  actor: {
    familyId: number;
    memberId: number;
    isAdmin: boolean;
    isFounder?: boolean;
  }
): Promise<SaveFoodiesTemplateReturn> {
  const canManageGlobalTemplate = actor.isAdmin && actor.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
  const normalizedName = input.templateName.trim();
  const normalizedStatus = input.status.trim().toLowerCase();
  const normalizedJson = input.templateJson.trim();

  if (!normalizedName) {
    return {
      success: false,
      message: "Enter a template name before saving.",
    };
  }

  if (normalizedStatus !== "draft" && normalizedStatus !== "published") {
    return {
      success: false,
      message: "Template status must be draft or published.",
    };
  }

  const parsedTemplateJson = parseSerializedTipTapDocument(normalizedJson);
  if (!parsedTemplateJson.success) {
    return {
      success: false,
      message: parsedTemplateJson.message,
    };
  }

  const existingTemplate = input.id
    ? await db
      .select()
      .from(recipeTemplate)
      .where(eq(recipeTemplate.id, input.id))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingTemplate) {
    return {
      success: false,
      message: `No template was found for id: ${input.id}`,
    };
  }

  if (existingTemplate) {
    if (existingTemplate.isGlobalTemplate && (!canManageGlobalTemplate || existingTemplate.familyId !== GLOBAL_TEMPLATE_FAMILY_ID)) {
      return {
        success: false,
        message: "Only the family 1 admin can edit global templates.",
      };
    }

    const isOwnerOrFounder = existingTemplate.memberId === actor.memberId || Boolean(actor.isFounder);

    if (!existingTemplate.isGlobalTemplate && (existingTemplate.familyId !== actor.familyId || !isOwnerOrFounder)) {
      return {
        success: false,
        message: "Only the template owner or the family founder can edit this template.",
      };
    }
  }

  const duplicateRows = await db
    .select({ id: recipeTemplate.id })
    .from(recipeTemplate)
    .where(
      input.id
        ? and(
          eq(recipeTemplate.familyId, actor.familyId),
          ilike(recipeTemplate.templateName, normalizedName),
          ne(recipeTemplate.id, input.id)
        )
        : and(eq(recipeTemplate.familyId, actor.familyId), ilike(recipeTemplate.templateName, normalizedName))
    );

  if (duplicateRows.length > 0) {
    return {
      success: false,
      message: "A template with this name already exists in your family.",
    };
  }

  try {
    const [savedTemplate] = existingTemplate
      ? await db
        .update(recipeTemplate)
        .set({
          templateName: normalizedName,
          status: normalizedStatus,
          templateJson: serializeTipTapDocument(parsedTemplateJson.content),
          updatedAt: new Date(),
        })
        .where(eq(recipeTemplate.id, existingTemplate.id))
        .returning()
      : await db
        .insert(recipeTemplate)
        .values({
          templateName: normalizedName,
          status: normalizedStatus,
          isGlobalTemplate: false,
          templateJson: serializeTipTapDocument(parsedTemplateJson.content),
          memberId: actor.memberId,
          familyId: actor.familyId,
        })
        .returning();

    const templates = await loadFoodiesTemplateManagementRecords(actor.familyId, actor.memberId, canManageGlobalTemplate, Boolean(actor.isFounder));
    const savedTemplateRecord = templates.find((template) => template.id === savedTemplate.id);

    if (!savedTemplateRecord) {
      return {
        success: false,
        message: "Template was saved but could not be reloaded.",
      };
    }

    return {
      success: true,
      template: savedTemplateRecord,
      message: `Template "${savedTemplateRecord.templateName}" saved successfully.`,
    };
  } catch (error) {
    logDbQueryError("foodies.saveFoodiesTemplate", error, {
      templateId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
      isAdmin: actor.isAdmin,
    });
    return {
      success: false,
      message: error instanceof Error
        ? `Failed to save template changes: ${error.message}`
        : "Failed to save template changes.",
    };
  }
}

export async function deleteFoodiesTemplate(
  templateId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const existingTemplate = await db
    .select()
    .from(recipeTemplate)
    .where(eq(recipeTemplate.id, templateId))
    .then((rows) => rows[0] ?? null);

  if (!existingTemplate) {
    return {
      success: false,
      message: `No template was found for id: ${templateId}`,
    };
  }

  if (existingTemplate.isGlobalTemplate) {
    return {
      success: false,
      message: "Global templates cannot be deleted.",
    };
  }

  const isOwnerOrFounder = existingTemplate.memberId === actor.memberId || Boolean(actor.isFounder);

  if (existingTemplate.familyId !== actor.familyId || !isOwnerOrFounder) {
    return {
      success: false,
      message: "Only the template owner or the family founder can delete this template.",
    };
  }

  try {
    // Unlink recipes first: recipe.templateId cascades on delete and would remove recipes.
    await db
      .update(recipe)
      .set({ templateId: null })
      .where(eq(recipe.templateId, templateId));

    await db.delete(recipeTemplate).where(eq(recipeTemplate.id, templateId));

    return {
      success: true,
      message: `Template "${existingTemplate.templateName}" deleted.`,
    };
  } catch (error) {
    logDbQueryError("foodies.deleteFoodiesTemplate", error, {
      templateId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting recipe template",
    };
  }
}

async function loadFoodiesRecipeDetail(
  familyId: number,
  recipeId: number,
  viewerMemberId?: number
): Promise<FoodiesRecipeDetail | null> {
  const recipeRows = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.familyId, familyId), eq(recipe.id, recipeId), ne(recipe.status, "template")));

  if (!recipeRows || recipeRows.length === 0) {
    return null;
  }

  const recipeRow = recipeRows[0];
  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);

  if (!canViewDraftPost(recipeRow.status, recipeRow.memberId, viewerMemberId, viewerIsFounder)) {
    return null;
  }

  const [commentRows, likeRows, tagRows, discussionThreadsByRecipeId] = await Promise.all([
    db
      .select()
      .from(recipeComment)
      .where(eq(recipeComment.recipeId, recipeId))
      .orderBy(asc(recipeComment.createdAt)),
    db
      .select({
        memberId: recipeLike.memberId,
        likenessDegree: recipeLike.likenessDegree,
      })
      .from(recipeLike)
      .where(eq(recipeLike.recipeId, recipeId)),
    db
      .select({
        tagId: recipeTag.tagId,
        tagName: recipeTagReference.tagName,
        tagType: recipeTagReference.tagType,
      })
      .from(recipeTag)
      .innerJoin(recipeTagReference, eq(recipeTagReference.id, recipeTag.tagId))
      .where(eq(recipeTag.recipeId, recipeId)),
    loadDiscussionThreadSummariesByTargetIds(familyId, 'recipe', [recipeId]),
  ]);

  const commentMemberIds = [...new Set(commentRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))];
  const likeMemberIds = [...new Set(likeRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))];
  const memberIds = [...new Set([recipeRow.memberId, ...commentMemberIds, ...likeMemberIds])];

  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));

  const submitterLike = likeRows.find((row) => row.memberId === recipeRow.memberId) ?? null;
  const nonSubmitterLikeRows = likeRows.filter((row) => row.memberId !== recipeRow.memberId);
  const noRatingCount = nonSubmitterLikeRows.filter((row) => row.likenessDegree === -1).length;
  const thumbsUpCount = nonSubmitterLikeRows.filter((row) => row.likenessDegree === 1).length;
  const loveCount = nonSubmitterLikeRows.filter((row) => row.likenessDegree === 2).length;
  const thumbsUpMemberNames = nonSubmitterLikeRows
    .filter((row) => row.likenessDegree === 1)
    .map((row) => memberNameById.get(row.memberId) ?? `Member #${row.memberId}`)
    .sort((leftName, rightName) => leftName.localeCompare(rightName));
  const loveMemberNames = nonSubmitterLikeRows
    .filter((row) => row.likenessDegree === 2)
    .map((row) => memberNameById.get(row.memberId) ?? `Member #${row.memberId}`)
    .sort((leftName, rightName) => leftName.localeCompare(rightName));
  const recipeProTipRows = commentRows.filter((row) => row.isRecipeProTip && !isEmptyRecipeProTipComment(row.commentJson));
  const familyCommentRows = commentRows.filter((row) => !row.isRecipeProTip);

  const viewerLike = viewerMemberId
    ? likeRows.find((row) => row.memberId === viewerMemberId)
    : null;
  const likedByMember = Boolean(viewerLike && viewerLike.likenessDegree !== -1);
  const likenessDegree = viewerLike?.likenessDegree ?? null;

  const tagsByType = new Map<RecipeTagType, string[]>();
  for (const tagRow of tagRows) {
    const tagType = tagRow.tagType as RecipeTagType;
    const existing = tagsByType.get(tagType) ?? [];
    existing.push(tagRow.tagName);
    tagsByType.set(tagType, existing);
  }

  const tagIdsByRecipeId = new Map<number, number[]>();
  const tagNamesByTypeByRecipeId = new Map<number, Partial<Record<RecipeTagType, string[]>>>();

  for (const tagRow of tagRows) {
    const existingTagIds = tagIdsByRecipeId.get(recipeId) ?? [];
    existingTagIds.push(tagRow.tagId);
    tagIdsByRecipeId.set(recipeId, existingTagIds);

    const tagType = tagRow.tagType as RecipeTagType;
    const byType = tagNamesByTypeByRecipeId.get(recipeId) ?? {};
    const currentNames = byType[tagType] ?? [];
    byType[tagType] = [...currentNames, tagRow.tagName];
    tagNamesByTypeByRecipeId.set(recipeId, byType);
  }

  return {
    id: recipeRow.id,
    recipeTitle: recipeRow.recipeTitle,
    recipeShortSummary: recipeRow.recipeShortSummary,
    recipeJson: recipeRow.recipeJson,
    status: recipeRow.status,
    recipeImageUrl: recipeRow.recipeImageUrl,
    prepTimeMins: recipeRow.prepTimeMins,
    cookTimeMins: recipeRow.cookTimeMins,
    updatedAt: recipeRow.updatedAt ?? new Date(),
    memberId: recipeRow.memberId,
    familyId: recipeRow.familyId,
    submitterName: memberNameById.get(recipeRow.memberId) ?? `Member #${recipeRow.memberId}`,
    submitterImageUrl: memberImageUrlById.get(recipeRow.memberId) ?? null,
    submitterLikenessDegree: submitterLike?.likenessDegree ?? null,
    commentCount: familyCommentRows.length,
    noRatingCount,
    thumbsUpCount,
    loveCount,
    likedByMember,
    likenessDegree,
    selectedTagIds: tagIdsByRecipeId.get(recipeId) ?? [],
    tagNamesByType: tagNamesByTypeByRecipeId.get(recipeId) ?? {},
    templateId: recipeRow.templateId ?? null,
    thumbsUpMemberNames,
    loveMemberNames,
    discussionThreads: discussionThreadsByRecipeId.get(recipeId) ?? [],
    hasDiscussionThread: (discussionThreadsByRecipeId.get(recipeId) ?? []).length > 0,
    recipeProTips: recipeProTipRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt ?? new Date(),
      commenterName: memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
      memberId: row.memberId ?? 0,
      proTipJson: normalizeSerializedTipTapDocument(row.commentJson),
    })),
    recipeComments: familyCommentRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt ?? new Date(),
      commenterName: memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
      commentJson: normalizeSerializedTipTapDocument(row.commentJson),
    })),
  };
}

export async function getFoodiesRecipeDetail(
  familyId: number,
  recipeId: number,
  viewerMemberId?: number
): Promise<GetFoodiesRecipeDetailReturn> {
  try {
    const recipeDetail = await loadFoodiesRecipeDetail(familyId, recipeId, viewerMemberId);

    if (!recipeDetail) {
      return {
        success: false,
        message: "Recipe not found.",
      };
    }

    return {
      success: true,
      recipe: recipeDetail,
    };
  } catch (error) {
    logDbQueryError("foodies.getFoodiesRecipeDetail", error, { familyId, recipeId, viewerMemberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to load recipe detail.",
    };
  }
}

export async function toggleRecipeLike(
  recipeId: number,
  likenessDegree: number,
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<ToggleRecipeLikeReturn> {
  const existingRecipe = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.familyId, actor.familyId), eq(recipe.id, recipeId), ne(recipe.status, "template")))
    .then((rows) => rows[0] ?? null);

  if (!existingRecipe) {
    return {
      success: false,
      message: "Recipe not found.",
    };
  }

  if (![1, 2].includes(likenessDegree)) {
    return {
      success: false,
      message: "Invalid like type.",
    };
  }

  try {
    const existingLike = await db
      .select()
      .from(recipeLike)
      .where(
        and(
          eq(recipeLike.recipeId, recipeId),
          eq(recipeLike.memberId, actor.memberId)
        )
      )
      .then((rows) => rows[0] ?? null);

    if (existingLike && existingLike.likenessDegree === likenessDegree) {
      await db
        .delete(recipeLike)
        .where(
          and(
            eq(recipeLike.recipeId, recipeId),
            eq(recipeLike.memberId, actor.memberId),
            eq(recipeLike.likenessDegree, likenessDegree)
          )
        );
    } else if (existingLike) {
      await db
        .update(recipeLike)
        .set({
          likenessDegree,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(recipeLike.recipeId, recipeId),
            eq(recipeLike.memberId, actor.memberId)
          )
        );
    } else {
      await db
        .insert(recipeLike)
        .values({
          recipeId,
          memberId: actor.memberId,
          likenessDegree,
        });
    }

    if (!existingLike || existingLike.likenessDegree !== likenessDegree) {
      await createFamilyReactionActivityRecord({
        reactionType: likenessDegree === 2 ? "love" : "like",
        featureName: "The Kitchen",
        postName: existingRecipe.recipeTitle,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const updatedRecipe = await loadFoodiesRecipeDetail(actor.familyId, recipeId, actor.memberId);

    if (!updatedRecipe) {
      return {
        success: false,
        message: "Recipe was updated but could not be reloaded.",
      };
    }

    const actionText = existingLike && existingLike.likenessDegree === likenessDegree
      ? "reaction removed"
      : "reaction added";

    return {
      success: true,
      recipe: updatedRecipe,
      message: `Recipe ${actionText} successfully.`,
    };
  } catch (error) {
    logDbQueryError("foodies.toggleRecipeLike", error, {
      recipeId,
      likenessDegree,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to update recipe reaction.",
    };
  }
}

export async function addRecipeComment(
  input: {
    recipeId: number;
    commentText: string;
    clientRequestId?: string;
  },
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<AddRecipeCommentReturn> {
  const normalizedComment = input.commentText.trim();

  const parsedComment = parseSerializedTipTapDocument(normalizedComment);
  const commentJson = parsedComment.success
    ? serializeTipTapDocument(parsedComment.content)
    : serializeTipTapDocument(createTextTipTapDocument(normalizedComment));

  if (parsedComment.success && isTipTapDocumentEmpty(parsedComment.content)) {
    return {
      success: false,
      message: "Comment cannot be empty.",
    };
  }

  if (!parsedComment.success && normalizedComment.length < 2) {
    return {
      success: false,
      message: "Comment must be at least 2 characters.",
    };
  }

  const existingRecipe = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.familyId, actor.familyId), eq(recipe.id, input.recipeId), ne(recipe.status, "template")))
    .then((rows) => rows[0] ?? null);

  if (!existingRecipe) {
    return {
      success: false,
      message: "Recipe not found.",
    };
  }

  try {
    const duplicateRequest = input.clientRequestId
      ? await db
        .insert(pwaMutationRequest)
        .values({
          requestKey: input.clientRequestId,
          mutationName: "foodies.addRecipeComment",
          entityType: "recipe",
          entityId: input.recipeId,
          familyId: actor.familyId,
          memberId: actor.memberId,
        })
        .onConflictDoNothing({ target: pwaMutationRequest.requestKey })
        .returning({ id: pwaMutationRequest.id })
      : [{ id: 0 }];

    if (input.clientRequestId && duplicateRequest.length === 0) {
      const existingRecipeDetail = await loadFoodiesRecipeDetail(actor.familyId, input.recipeId, actor.memberId);

      if (!existingRecipeDetail) {
        return {
          success: false,
          message: "Recipe comment was already submitted, but the recipe could not be reloaded.",
        };
      }

      return {
        success: true,
        recipe: existingRecipeDetail,
        message: "Comment already synced.",
      };
    }

    await db
      .insert(recipeComment)
      .values({
        recipeId: input.recipeId,
        memberId: actor.memberId,
        commentJson,
        isRecipeProTip: false,
      });

    await createFamilyActivityRecord({
      actionType: FAMILY_ACTIVITY_ACTION_TYPES.COMMENT_CREATED,
      featureName: "The Kitchen",
      postName: existingRecipe.recipeTitle,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });

    const updatedRecipe = await loadFoodiesRecipeDetail(actor.familyId, input.recipeId, actor.memberId);

    if (!updatedRecipe) {
      return {
        success: false,
        message: "Comment was added but recipe could not be reloaded.",
      };
    }

    return {
      success: true,
      recipe: updatedRecipe,
      message: "Comment posted successfully.",
    };
  } catch (error) {
    logDbQueryError("foodies.addRecipeComment", error, {
      recipeId: input.recipeId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      clientRequestId: input.clientRequestId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to add comment.",
    };
  }
}

/*------------------ getRecipeTerms ------------------ */
export async function getRecipeTerms(): Promise<RecipeTermsReturn> {
  const result = await db
    .select()
    .from(recipeTerm)
    .orderBy(asc(recipeTerm.term));

  const recipeTerms = result.map((row) => ({
    id: row.id,
    term: row.term,
    termJson: row.termJson,
    status: row.status,
    updatedAt: row.updatedAt as Date,
  }));

  return { success: true, recipeTerms };
}

export async function getRecipeTermById(id: number): Promise<GetRecipeTermReturn> {
  const [result] = await db
    .select()
    .from(recipeTerm)
    .where(eq(recipeTerm.id, id));

  if (!result) {
    return { success: false, message: `No recipe term found for id: ${id}` };
  }

  return {
    success: true,
    recipeTerm: {
      id: result.id,
      term: result.term,
      termJson: result.termJson,
      status: result.status,
      updatedAt: result.updatedAt as Date,
    },
  };
}

export async function saveRecipeTerm(
  input: SaveRecipeTermInput,
  actor: { familyId: number; isAdmin: boolean }
): Promise<SaveRecipeTermReturn> {
  if (!(actor.familyId === GLOBAL_CONTENT_OWNER_FAMILY_ID && actor.isAdmin)) {
    return {
      success: false,
      message: "Only the family 1 admin can maintain recipe terms.",
    };
  }

  const parsedTermJson = parseSerializedTipTapDocument(input.termJson.trim());

  if (!parsedTermJson.success) {
    return { success: false, message: parsedTermJson.message };
  }

  const termPayload = {
    term: input.term.trim(),
    termJson: serializeTipTapDocument(parsedTermJson.content),
    status: input.status.trim(),
  };

  const duplicateConditions = input.id
    ? and(ilike(recipeTerm.term, termPayload.term), ne(recipeTerm.id, input.id))
    : ilike(recipeTerm.term, termPayload.term);

  const [existingTerm] = await db
    .select({ id: recipeTerm.id })
    .from(recipeTerm)
    .where(duplicateConditions)
    .limit(1);

  if (existingTerm) {
    return {
      success: false,
      message: `A term named "${termPayload.term}" already exists. Term names must be unique.`,
    };
  }

  if (input.id) {
    const [result] = await db
      .update(recipeTerm)
      .set(termPayload)
      .where(eq(recipeTerm.id, input.id))
      .returning();

    if (!result) {
      return { success: false, message: `Failed to update recipe term with id: ${input.id}` };
    }

    return {
      success: true,
      recipeTerm: {
        id: result.id,
        term: result.term,
        termJson: result.termJson,
        status: result.status,
        updatedAt: result.updatedAt as Date,
      },
      message: `Saved changes to "${result.term}".`,
    };
  }

  const [result] = await db
    .insert(recipeTerm)
    .values(termPayload)
    .returning();

  if (!result) {
    return { success: false, message: "Failed to create recipe term." };
  }

  return {
    success: true,
    recipeTerm: {
      id: result.id,
      term: result.term,
      termJson: result.termJson,
      status: result.status,
      updatedAt: result.updatedAt as Date,
    },
    message: `Created "${result.term}".`,
  };
}

export async function deleteRecipeTerm(
  id: number,
  actor: { familyId: number; isAdmin: boolean }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  if (!(actor.familyId === GLOBAL_CONTENT_OWNER_FAMILY_ID && actor.isAdmin)) {
    return {
      success: false,
      message: "Only the family 1 admin can maintain recipe terms.",
    };
  }

  const [existingTerm] = await db
    .select({ id: recipeTerm.id })
    .from(recipeTerm)
    .where(eq(recipeTerm.id, id))
    .limit(1);

  if (!existingTerm) {
    return {
      success: false,
      message: `No recipe term found for id: ${id}`,
    };
  }

  try {
    await db.delete(recipeTerm).where(eq(recipeTerm.id, id));

    return {
      success: true,
      message: "Recipe term deleted.",
    };
  } catch (error) {
    logDbQueryError("foodies.deleteRecipeTerm", error, { id, familyId: actor.familyId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting recipe term",
    };
  }
}

export async function deleteRecipe(
  recipeId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const permissionCheck = actor.isFounder
    ? and(eq(recipe.id, recipeId), eq(recipe.familyId, actor.familyId))
    : and(eq(recipe.id, recipeId), eq(recipe.familyId, actor.familyId), eq(recipe.memberId, actor.memberId));

  const existingRecipe = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(permissionCheck)
    .then((rows) => rows[0] ?? null);

  if (!existingRecipe) {
    return {
      success: false,
      message: `No recipe was found for id: ${recipeId}`,
    };
  }

  try {
    await db
      .delete(discussThread)
      .where(and(eq(discussThread.targetType, "recipe"), eq(discussThread.targetId, recipeId), eq(discussThread.familyId, actor.familyId)));

    await db
      .delete(recipe)
      .where(permissionCheck);

    return {
      success: true,
      message: "Recipe deleted.",
    };
  } catch (error) {
    logDbQueryError("foodies.deleteRecipe", error, {
      recipeId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      isFounder: actor.isFounder ?? false,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting recipe",
    };
  }
}
