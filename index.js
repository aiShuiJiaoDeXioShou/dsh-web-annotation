/**
 * Host half of dsh-web-annotation.
 *
 * The annotation flow is deliberately client-only: notes are inserted straight
 * into the composer and images are staged through the Conversation/attachment
 * services, so no report files, no Host routes, and no message rewriting are
 * involved. This Host entry exists only because every DSH bundle needs one.
 */
export const inject = []

export function apply() {}
