"use client";

import { useActionState, useState } from "react";
import { StarRating } from "@/components/ui/star-rating";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  submitReviewAction,
  type SubmitReviewState,
} from "./submit-review-action";

const COMMENT_MAX_LENGTH = 500;
const COMMENT_MIN_LENGTH_LOW_NOTE = 10;
const LOW_NOTE_THRESHOLD = 3;

const initialState: SubmitReviewState = {};

export function AvisForm({
  orderId,
  exploitation,
  codeCommande,
}: {
  orderId: string;
  exploitation: string;
  codeCommande: string;
}) {
  const [state, formAction, pending] = useActionState(
    submitReviewAction,
    initialState,
  );

  const [note, setNote] = useState<number>(5);
  const [commentaire, setCommentaire] = useState<string>("");

  const requiresComment = note <= LOW_NOTE_THRESHOLD;
  const commentTooShort =
    requiresComment && commentaire.trim().length < COMMENT_MIN_LENGTH_LOW_NOTE;
  const commentTooLong = commentaire.length > COMMENT_MAX_LENGTH;
  const canSubmit = !commentTooShort && !commentTooLong && note >= 1 && !pending;

  return (
    <form action={formAction} className="mt-6 space-y-6">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="note" value={note} />

      <div>
        <p className="text-sm text-terroir-muted">
          Commande {codeCommande} — {exploitation}
        </p>
      </div>

      <div>
        <label
          id="note-label"
          className="block text-sm font-medium text-terra-900"
        >
          Note <span aria-hidden className="text-red-700">*</span>
        </label>
        <div className="mt-2">
          <StarRating
            value={note}
            onChange={setNote}
            size="lg"
            aria-labelledby="note-label"
          />
        </div>
        <p className="mt-1 text-xs text-terroir-muted">
          {note}/5 étoile{note > 1 ? "s" : ""}
        </p>
        {state.fieldErrors?.note ? (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {state.fieldErrors.note}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="commentaire"
          className="block text-sm font-medium text-terra-900"
        >
          Commentaire{" "}
          {requiresComment ? (
            <span aria-hidden className="text-red-700">
              *
            </span>
          ) : (
            <span className="text-terroir-muted">(optionnel)</span>
          )}
        </label>
        <Textarea
          id="commentaire"
          name="commentaire"
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          rows={5}
          maxLength={COMMENT_MAX_LENGTH}
          aria-required={requiresComment}
          aria-invalid={commentTooShort || commentTooLong}
          className="mt-2 w-full"
          placeholder={
            requiresComment
              ? `Explique-nous ce qui n'a pas été (${COMMENT_MIN_LENGTH_LOW_NOTE} caractères minimum).`
              : "Optionnel — partage ton expérience."
          }
        />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
          {requiresComment && commentTooShort ? (
            <p role="alert" className="text-red-700">
              Pour une note de {LOW_NOTE_THRESHOLD} étoiles ou moins, un
              commentaire d&rsquo;au moins {COMMENT_MIN_LENGTH_LOW_NOTE}{" "}
              caractères est requis.
            </p>
          ) : (
            <span className="text-terroir-muted">
              {requiresComment
                ? "Obligatoire pour une note basse — aide le producteur à comprendre."
                : "Maximum 500 caractères (~50 mots)."}
            </span>
          )}
          <span
            className={
              commentTooLong ? "text-red-700" : "text-terroir-muted"
            }
            aria-live="polite"
          >
            {commentaire.length}/{COMMENT_MAX_LENGTH}
          </span>
        </div>
        {state.fieldErrors?.commentaire ? (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {state.fieldErrors.commentaire}
          </p>
        ) : null}
      </div>

      {state.error && !state.fieldErrors ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={!canSubmit}
        >
          {pending ? "Envoi…" : "Publier mon avis"}
        </Button>
        <a
          href="/compte/mes-avis"
          className="text-sm text-terra-700 hover:underline"
        >
          Annuler
        </a>
      </div>
    </form>
  );
}
