'use server'

import { updateTag } from 'next/cache'

import { api } from '@/lib/api/client'
import { NOTES_TAG } from '@/lib/api/queries'
import type { AiQueryResponse, Note, NoteCreate, NoteUpdate } from '@/lib/api/types'

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Writes go through server actions rather than client fetches so `BACKEND_URL`
 * stays server-side. Errors come back as values - a rejected promise in an
 * action surfaces to the client as an opaque digest, which is useless in a form.
 */

function failed(cause: unknown, fallback: string): { ok: false; error: string } {
  if (cause instanceof Error && cause.cause !== undefined) {
    return { ok: false, error: 'Cannot reach the backend API.' }
  }
  return { ok: false, error: fallback }
}

export async function createNote(input: NoteCreate): Promise<ActionResult<Note>> {
  const text = input.text.trim()
  if (!text) return { ok: false, error: 'Note text cannot be empty.' }

  try {
    const { data, error } = await api.POST('/notes', {
      body: { ...input, text },
    })
    if (error || !data) return { ok: false, error: 'Could not save the note.' }

    updateTag(NOTES_TAG)
    return { ok: true, data }
  } catch (cause) {
    return failed(cause, 'Could not save the note.')
  }
}

export async function updateNote(
  noteId: number,
  input: NoteUpdate,
): Promise<ActionResult<Note>> {
  try {
    const { data, error, response } = await api.PUT('/notes/{note_id}', {
      params: { path: { note_id: noteId } },
      body: input,
    })
    if (response.status === 404) return { ok: false, error: 'That note no longer exists.' }
    if (error || !data) return { ok: false, error: 'Could not update the note.' }

    updateTag(NOTES_TAG)
    return { ok: true, data }
  } catch (cause) {
    return failed(cause, 'Could not update the note.')
  }
}

export async function deleteNote(noteId: number): Promise<ActionResult<null>> {
  try {
    const { error, response } = await api.DELETE('/notes/{note_id}', {
      params: { path: { note_id: noteId } },
    })
    if (response.status === 404) return { ok: false, error: 'That note no longer exists.' }
    if (error) return { ok: false, error: 'Could not delete the note.' }

    updateTag(NOTES_TAG)
    return { ok: true, data: null }
  } catch (cause) {
    return failed(cause, 'Could not delete the note.')
  }
}

export async function askAi(question: string): Promise<ActionResult<AiQueryResponse>> {
  const trimmed = question.trim()
  if (!trimmed) return { ok: false, error: 'Ask a question first.' }

  try {
    const { data, error } = await api.POST('/ai/query', {
      body: { question: trimmed },
    })
    if (error || !data) return { ok: false, error: 'The AI query failed.' }
    return { ok: true, data }
  } catch (cause) {
    return failed(cause, 'The AI query failed.')
  }
}
