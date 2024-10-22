import { fail } from '@sveltejs/kit';
import { createInvitation } from '$lib/db/invitations';
import { getUserByEmail } from '$lib/db/users';
import { getGroup } from '$lib/db/groups';
import { getGroupsForUser, isUserInGroup } from '$lib/db/usersToGroups';
import InvitationEmail from '$lib/components/email/Invitation.svelte';
import { requireAuth } from '$lib/utils/auth';
import { EMAIL_DOMAIN, getMailgunClient, renderTemplate, SYSTEM_SENDER } from '$lib/utils/email';
import { formDataToObject, type Maybe } from '$lib/utils/types';
import { MAILGUN_API_KEY } from '$env/static/private';

export async function load(event) {
	const session = requireAuth(event);
	const userId = session.user.id;
	// Check whether the user belongs to the group in the
	let toGroupId = event.url.searchParams.get('toGroup');
	const userBelongsToGroup = toGroupId && (await isUserInGroup(userId, toGroupId));
	if (!userBelongsToGroup) toGroupId = null;
	return {
		session,
		toGroupId,
		groups: getGroupsForUser(userId)
	};
}

export const actions = {
	default: async ({ request, locals, url }) => {
		const user = locals.session?.user;
		if (!user) {
			return fail(403, {
				errors: 'Cannot create an invitation while signed out.'
			});
		}
		const fromUserId = user.id;
		const formData = await request.formData();
		const data = formDataToObject(formData);
		// First, the ID for the group and check that the current user belongs to it
		const toGroupId = data.toGroupId;
		const toGroup = await getGroup(toGroupId);
		const userBelongsToGroup = toGroup && (await isUserInGroup(fromUserId, toGroupId));
		if (!userBelongsToGroup) {
			return fail(403, {
				errors: ['Cannot send invitation for a group to which you do not belong.']
			});
		}
		// Then, get the email the user would like to invite and check whether it
		// belongs to an existing user in the system. If they exist, reference their ID
		// on the invitation.
		let toUserId: Maybe<string>;
		const toEmail = data.toEmail;
		const toUser = await getUserByEmail(toEmail);
		if (toUser) toUserId = toUser.id;
		// Record the invitation to the database.
		const invitation = await createInvitation({ fromUserId, toUserId, toEmail, toGroupId });
		// Send an email with a link to accept the invitation.
		try {
			const { html, text } = renderTemplate(InvitationEmail, {
				origin: url.origin,
				invitation,
				fromUser: user,
				toUser,
				toGroup
			});
			const client = getMailgunClient(MAILGUN_API_KEY);
			const result = await client.messages.create(EMAIL_DOMAIN, {
				from: SYSTEM_SENDER,
				to: [invitation.toEmail],
				subject: `You're invited to join ${user.username}'s group on CO-OP`,
				html,
				text
			});
			console.log(result);
		} catch (error) {
			return fail(500, {
				errors: [String(error)]
			});
		}
		return { success: true, data: { invitation } };
	}
};
