/**
 * Question Form Rendering
 *
 * Renders AskUserQuestion prompts as interactive HTML forms.
 * Provides both inline HTML generation and form data parsing.
 */

import type { HitlQuestionDefinition } from '../hitl/contractTypes';
import {
	isFreeTextQuestion,
	mapSelectionsToQuestionLabels,
	resolveQuestionResponseAction,
} from '../hitl/questionPolicy';

/** Shape of questions from the AskUserQuestion tool */
type QuestionDef = HitlQuestionDefinition[];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ParsedAnswers = Record<string, string | string[]>;
interface ParsedQuestionSubmission {
	answers: ParsedAnswers;
	responseAction?: 'resume' | 'complete';
}

interface InlineFormField {
	id: string;
	label: string;
	required: boolean;
	type: 'textarea' | 'radio' | 'checkbox';
	options?: Array<{
		label: string;
		value: string;
		action?: 'resume' | 'complete';
	}>;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML Escaping
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Question → Form Field Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map AskUserQuestion questions to form fields
 */
export function mapQuestionsToFormFields(
	questions: QuestionDef,
): InlineFormField[] {
	return questions.map((q, index) => {
		const hasOptions = Array.isArray(q.options) && q.options.length > 0 && !isFreeTextQuestion(q);

			if (hasOptions) {
				const options = (q.options ?? []).map((opt) => ({
					label: opt.label,
					value: opt.value ?? opt.label,
					action: opt.action,
				}));

			return {
				id: `field-${index}`,
				label: q.header ? `${q.header}: ${q.question}` : q.question,
				required: true,
				type: q.multiSelect ? 'checkbox' : 'radio',
				options,
			} as InlineFormField;
		}

		// No options -> free text
		return {
			id: `field-${index}`,
			label: q.header ? `${q.header}: ${q.question}` : q.question,
			required: true,
			type: 'textarea',
		} as InlineFormField;
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// POST Response Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely parse JSON array from string
 */
function safeJsonArray(value: unknown): string[] | null {
	if (typeof value !== 'string') return null;
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : null;
	} catch {
		return null;
	}
}

function buildQuestionFieldKeys(question: QuestionDef[number], index: number): string[] {
	const keys = new Set<string>([`field-${index}`]);
	const candidateNames = [
		question.header,
		question.question,
		question.header ? `${question.header}: ${question.question}` : question.question,
	];

	for (const candidate of candidateNames) {
		const trimmed = candidate?.trim();
		if (trimmed) {
			keys.add(`field-${trimmed}`);
		}
	}

	return [...keys];
}

function resolveQuestionFieldValue(
	bodyData: Record<string, unknown>,
	question: QuestionDef[number],
	index: number,
): unknown {
	for (const key of buildQuestionFieldKeys(question, index)) {
		if (bodyData[key] != null) {
			return bodyData[key];
		}
	}
	return undefined;
}

function parseOptionSelections(raw: unknown, multiSelect: boolean): string[] {
	const parsedArray = safeJsonArray(raw);
	if (parsedArray) {
		return parsedArray.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
	}

	if (typeof raw !== 'string') {
		return [];
	}

	const text = raw.trim();
	if (text.length === 0) {
		return [];
	}

	if (!multiSelect) {
		return [text];
	}

	if (!text.includes(',')) {
		return [text];
	}

	return text
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

/**
 * Parse form POST data into answers keyed by question text
 */
export function parseQuestionAnswers(
	bodyData: Record<string, unknown>,
	questions: QuestionDef,
): ParsedAnswers {
	const answers: ParsedAnswers = {};

	for (let i = 0; i < questions.length; i++) {
		const q = questions[i];
		const raw = resolveQuestionFieldValue(bodyData, q, i);

		if (raw == null) continue;

		const answerKey = q.header || q.question;

		if (q.options?.length && !isFreeTextQuestion(q)) {
			const selected = mapSelectionsToQuestionLabels({
				question: q,
				selectionValue: parseOptionSelections(raw, q.multiSelect ?? false),
			});
			if (q.multiSelect) {
				// Agent SDK expects a string for multi-select labels, joined with ", ".
				if (selected.length > 0) {
					answers[answerKey] = selected.join(', ');
				}
			} else {
				// Radio: take first selected non-empty value
				const first = selected.find((entry) => entry.length > 0);
				if (first) {
					answers[answerKey] = first;
				}
			}
		} else {
			// Free-text (textarea)
			const text = String(raw).trim();
			if (text.length > 0) {
				answers[answerKey] = text;
			}
		}
	}

	return answers;
}

export function parseQuestionSubmission(
	bodyData: Record<string, unknown>,
	questions: QuestionDef,
): ParsedQuestionSubmission {
	const answers = parseQuestionAnswers(bodyData, questions);
	return {
		answers,
		responseAction: resolveQuestionResponseAction({
			questions,
			answers,
			explicitResponseAction: bodyData.responseAction,
		}),
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline HTML Form Rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Content Security Policy for sandboxed form
 */
export const FORM_CSP =
	'sandbox allow-downloads allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-presentation allow-scripts allow-top-navigation allow-top-navigation-by-user-activation allow-top-navigation-to-custom-protocols';

/**
 * Render an inline HTML form for AskUserQuestion prompts
 */
function renderQuestionForm(params: {
	title: string;
	description?: string;
	fields: InlineFormField[];
	submitUrl?: string;
}): string {
	const { title, description, fields } = params;

	const fieldsHtml = fields
		.map((f) => {
			const requiredClass = f.required ? 'form-required' : '';

			if (f.type === 'checkbox' || f.type === 'radio') {
				const isRadio = f.type === 'radio';
					const options = (f.options ?? [])
						.map((opt, idx) => {
							const optionId = `opt_${idx}_${f.id}`;
							return `
						<div class="multiselect-option">
							<input type="checkbox" class="multiselect-checkbox" id="${optionId}" value="${escapeHtml(opt.value)}" data-action="${escapeHtml(opt.action ?? 'resume')}" />
							<label for="${optionId}">${escapeHtml(opt.label)}</label>
						</div>`;
						})
						.join('');

				// Add "Other" option with text input for custom responses
				const otherOptionId = `opt_other_${f.id}`;
					const otherOption = `
						<div class="multiselect-option other-option">
							<input type="checkbox" class="multiselect-checkbox other-checkbox" id="${otherOptionId}" value="__OTHER__" data-action="resume" />
							<label for="${otherOptionId}">Other (type your own)</label>
						</div>
						<input type="text" class="form-input other-input" id="${f.id}_other" placeholder="Type your answer..." style="display: none; margin-top: 8px;" />
				`;

				return `
				<div class="form-group">
					<label class="form-label ${requiredClass}">${escapeHtml(f.label)}</label>
					<div class="multiselect" id="${f.id}" ${isRadio ? 'data-radio-select="radio"' : ''}>
						${options}
						${otherOption}
					</div>
					<p class="error-${f.id} error-hidden">This field is required</p>
				</div>`;
			}

			// Textarea for free text
			return `
				<div class="form-group">
					<label class="form-label ${requiredClass}" for="${f.id}">${escapeHtml(f.label)}</label>
					<textarea class="form-input ${requiredClass}" id="${f.id}" name="${f.id}" rows="3"></textarea>
					<p class="error-${f.id} error-hidden">This field is required</p>
				</div>`;
		})
		.join('\n');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(title)}</title>
	<style>
		:root {
			--font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
			--color-background: #f5f5f5;
			--color-card-bg: #ffffff;
			--color-card-border: #e0e0e0;
			--color-header: #1a1a1a;
			--color-label: #333333;
			--color-input-border: #d0d0d0;
			--color-input-text: #333333;
			--color-submit-btn-bg: #d97706;
			--color-submit-btn-hover: #b45309;
			--color-submit-btn-text: #ffffff;
			--color-error: #dc2626;
			--color-required: #d97706;
			--color-focus-border: #d97706;
			--color-success-bg: #f0fdf4;
			--color-success-border: #22c55e;
			--border-radius-card: 12px;
			--border-radius-input: 8px;
			--padding-card: 24px;
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body { font-family: var(--font-family); background: var(--color-background); min-height: 100vh; padding: 24px 16px; }
		.container { margin: 0 auto; max-width: 500px; }
		.card { background: var(--color-card-bg); border: 1px solid var(--color-card-border); border-radius: var(--border-radius-card); padding: var(--padding-card); box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
		.form-header { margin-bottom: 20px; }
		.form-header h1 { color: var(--color-header); font-size: 22px; font-weight: 600; margin-bottom: 8px; }
		.form-header p { color: #666; font-size: 14px; line-height: 1.5; white-space: pre-line; }
		.form-group { margin-bottom: 20px; }
		.form-label { display: block; color: var(--color-label); font-size: 14px; font-weight: 600; margin-bottom: 8px; line-height: 1.4; }
		.form-required::after { content: ' *'; color: var(--color-required); }
		.form-input { width: 100%; border: 1px solid var(--color-input-border); border-radius: var(--border-radius-input); padding: 12px; color: var(--color-input-text); font-size: 14px; font-family: inherit; resize: vertical; }
		.form-input:focus { outline: none; border-color: var(--color-focus-border); box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.1); }
		#submit-btn { width: 100%; height: 48px; margin-top: 8px; border: 0; border-radius: var(--border-radius-input); background: var(--color-submit-btn-bg); color: var(--color-submit-btn-text); font-size: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
		#submit-btn:hover { background: var(--color-submit-btn-hover); }
		#submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
		.error-hidden { visibility: hidden; height: 0; margin: 0; color: var(--color-error); font-size: 12px; }
		.error-show { visibility: visible; height: auto; margin-top: 6px; }
		.multiselect { display: flex; flex-direction: column; gap: 8px; }
		.multiselect-option { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; background: #fafafa; border: 1px solid #e5e5e5; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
		.multiselect-option:hover { background: #f0f0f0; border-color: #d0d0d0; }
		.multiselect-option.selected { background: #fffbeb; border-color: var(--color-submit-btn-bg); }
		.multiselect-checkbox { width: 18px; height: 18px; margin-top: 2px; cursor: pointer; accent-color: var(--color-submit-btn-bg); }
		.multiselect-option label { flex: 1; cursor: pointer; font-size: 14px; line-height: 1.4; color: #333; }
		.success-card { background: var(--color-success-bg); border-color: var(--color-success-border); }
		.success-card h1 { color: #166534; }
		.success-card p { color: #166534; }
		.claude-badge { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e5e5; text-align: center; }
		.claude-badge span { font-size: 12px; color: #888; }
		.other-option { border-style: dashed; }
		.other-input { margin-top: 8px; margin-left: 28px; width: calc(100% - 28px); }
	</style>
</head>
<body>
	<div class="container">
		<form class="card" id="n8n-form" method="POST" novalidate>
			<div class="form-header">
				<h1>${escapeHtml(title)}</h1>
				${description ? `<p>${escapeHtml(description)}</p>` : ''}
			</div>
			${fieldsHtml}
			<button id="submit-btn" type="submit">Submit Response</button>
			<div class="claude-badge">
				<span>Powered by Claude Agent SDK</span>
			</div>
		</form>
		<div class="card success-card" id="submitted-form" style="display:none;">
			<div class="form-header">
				<h1>✓ Response Submitted</h1>
				<p>Your answers have been recorded. You can close this page now.</p>
			</div>
		</div>
	</div>

	<script>
		function updateError(el, show) {
			if (!el) return;
			if (show) el.classList.add('error-show');
			else el.classList.remove('error-show');
		}

			function getSelectedValues(container) {
				const values = [];
				const otherInput = container.parentElement.querySelector('.other-input');
				container.querySelectorAll('.multiselect-checkbox').forEach(cb => {
				if (cb.checked) {
					// If "Other" is selected, use the text input value instead
					if (cb.value === '__OTHER__' && otherInput) {
						const otherValue = otherInput.value.trim();
						if (otherValue) values.push(otherValue);
					} else {
						values.push(cb.value.trim());
					}
				}
				});
				return values;
			}

			function getSelectedAction(container) {
				let sawResume = false;
				let sawComplete = false;
				container.querySelectorAll('.multiselect-checkbox').forEach(cb => {
					if (!cb.checked) return;
					if (cb.dataset.action === 'resume') sawResume = true;
					if (cb.dataset.action === 'complete') sawComplete = true;
				});
				if (sawResume) return 'resume';
				if (sawComplete) return 'complete';
				return undefined;
			}

		// Handle "Other" input visibility
		function updateOtherInput(container) {
			const otherCheckbox = container.querySelector('.other-checkbox');
			const otherInput = container.parentElement.querySelector('.other-input');
			if (otherCheckbox && otherInput) {
				otherInput.style.display = otherCheckbox.checked ? 'block' : 'none';
				if (otherCheckbox.checked) {
					otherInput.focus();
				}
			}
		}

		// Toggle option selection styling
		document.querySelectorAll('.multiselect-option').forEach(option => {
			const checkbox = option.querySelector('.multiselect-checkbox');
			const container = option.closest('.multiselect');
			const isRadio = container?.dataset.radioSelect === 'radio';

			option.addEventListener('click', (e) => {
				if (e.target === checkbox || e.target.classList.contains('other-input')) return;

				if (isRadio) {
					// Deselect others in radio mode
					container.querySelectorAll('.multiselect-option').forEach(opt => {
						opt.classList.remove('selected');
						opt.querySelector('.multiselect-checkbox').checked = false;
					});
				}

				checkbox.checked = !checkbox.checked || isRadio;
				option.classList.toggle('selected', checkbox.checked);
				updateOtherInput(container);
			});

			checkbox.addEventListener('change', () => {
				if (isRadio && checkbox.checked) {
					container.querySelectorAll('.multiselect-option').forEach(opt => {
						if (opt !== option) {
							opt.classList.remove('selected');
							opt.querySelector('.multiselect-checkbox').checked = false;
						}
					});
				}
				option.classList.toggle('selected', checkbox.checked);
				updateOtherInput(container);
			});
		});

		const form = document.getElementById('n8n-form');
		const submitBtn = document.getElementById('submit-btn');

		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			let allValid = true;

			// Validate multiselects (check parent .form-group for required label)
			document.querySelectorAll('.multiselect').forEach(ms => {
				const errorEl = document.querySelector('.error-' + ms.id);
				const values = getSelectedValues(ms);
				const otherCheckbox = ms.querySelector('.other-checkbox');
				const otherInput = ms.parentElement.querySelector('.other-input');

				// Check if "Other" is selected but no text provided
				if (otherCheckbox?.checked && otherInput && !otherInput.value.trim()) {
					updateError(errorEl, true);
					allValid = false;
				} else if (values.length === 0) {
					updateError(errorEl, true);
					allValid = false;
				} else {
					updateError(errorEl, false);
				}
			});

			// Validate textareas
			document.querySelectorAll('textarea.form-required').forEach(input => {
				const errorEl = document.querySelector('.error-' + input.id);
				if (!input.value.trim()) {
					updateError(errorEl, true);
					allValid = false;
				} else {
					updateError(errorEl, false);
				}
			});

			if (!allValid) return;

			submitBtn.disabled = true;
			submitBtn.textContent = 'Submitting...';

			const formData = new FormData();

			// Add textareas
			document.querySelectorAll('textarea').forEach(ta => {
				if (ta.name) formData.append(ta.name, ta.value);
			});

				// Add multiselects as JSON arrays
				document.querySelectorAll('.multiselect').forEach(ms => {
					formData.append(ms.id, JSON.stringify(getSelectedValues(ms)));
				});

				let responseAction = undefined;
				document.querySelectorAll('.multiselect').forEach(ms => {
					const action = getSelectedAction(ms);
					if (action === 'resume') {
						responseAction = 'resume';
					} else if (!responseAction && action === 'complete') {
						responseAction = 'complete';
					}
				});
				formData.append('responseAction', responseAction || 'resume');

				try {
				const res = await fetch(window.location.href, {
					method: 'POST',
					body: formData,
				});

				if (res.ok) {
					form.style.display = 'none';
					document.getElementById('submitted-form').style.display = 'block';
				} else {
					submitBtn.disabled = false;
					submitBtn.textContent = 'Submit Response';
					alert('Failed to submit. Please try again.');
				}
			} catch (err) {
				submitBtn.disabled = false;
				submitBtn.textContent = 'Submit Response';
				alert('Network error. Please try again.');
			}
		});
	</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a complete question form HTML from PendingQuestion data
 */
export function buildQuestionFormHtml(
	questions: QuestionDef,
	title = 'Questions',
	description?: string,
): string {
	const fields = mapQuestionsToFormFields(questions);
	return renderQuestionForm({ title, description, fields });
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval Confirmation Page (CSRF-safe GET to POST)
// ─────────────────────────────────────────────────────────────────────────────

interface ApprovalConfirmationParams {
	approved: boolean;
	/** Optional tool name to show the reviewer what they are deciding on. */
	toolName?: string;
}

/**
 * Render a confirmation page for an approve/deny decision.
 *
 * Approve/deny links are emailed and posted to chat, where link scanners,
 * unfurlers and browser prefetch issue automatic GET requests. A GET must
 * therefore never consume the decision. This page is what the GET returns: a
 * plain HTML form that POSTs the decision back to the *same* URL (so the
 * `approved`/`requestId` query params are preserved), consumed only when the
 * reviewer deliberately clicks the button.
 *
 * It intentionally contains NO script and NO auto-submit (no `form.submit()`,
 * no `onload`, no meta-refresh) — any of those would re-introduce the exact
 * automatic-approval problem this page exists to prevent.
 */
export function buildApprovalConfirmationHtml(params: ApprovalConfirmationParams): string {
	const { approved, toolName } = params;
	const decisionWord = approved ? 'approve' : 'deny';
	const title = approved ? 'Confirm approval' : 'Confirm denial';
	const accent = approved ? '#166534' : '#991b1b';
	const buttonBg = approved ? '#166534' : '#991b1b';
	const buttonLabel = approved ? 'Approve' : 'Deny';
	const target = toolName ? escapeHtml(toolName) : null;
	const prompt = target
		? `You are about to <strong>${escapeHtml(decisionWord)}</strong> the tool <code>${target}</code>.`
		: `You are about to <strong>${escapeHtml(decisionWord)}</strong> this request.`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(title)}</title>
	<style>
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 24px 16px; }
		.card { background: #fff; border: 1px solid #e0e0e0; border-radius: 12px; padding: 32px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); max-width: 420px; width: 100%; text-align: center; }
		h1 { color: ${accent}; font-size: 22px; font-weight: 600; margin-bottom: 12px; }
		p { color: #444; font-size: 15px; line-height: 1.5; margin-bottom: 24px; }
		code { background: #f0f0f0; border-radius: 4px; padding: 2px 6px; font-size: 13px; }
		button { width: 100%; height: 48px; border: 0; border-radius: 8px; background: ${buttonBg}; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }
		button:hover { filter: brightness(0.95); }
		.note { margin-top: 16px; font-size: 12px; color: #888; }
	</style>
</head>
<body>
	<div class="card">
		<h1>${escapeHtml(title)}</h1>
		<p>${prompt}</p>
		<form method="POST" novalidate>
			<input type="hidden" name="approved" value="${approved ? 'true' : 'false'}" />
			<input type="hidden" name="responseAction" value="resume" />
			<button type="submit">${escapeHtml(buttonLabel)}</button>
		</form>
		<p class="note">This action is applied only when you click the button above.</p>
	</div>
</body>
</html>`;
}
