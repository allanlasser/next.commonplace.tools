import { createInvitation } from '$lib/db/invitations';
import { getUserByEmail } from '$lib/db/users';
import { getGroupsForUser, isUserInGroup } from '$lib/db/usersToGroups';
import { requireAuth } from '$lib/utils/auth';
import { formDataToObject, type Maybe } from '$lib/utils/types';
import { fail } from '@sveltejs/kit';

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
	default: async ({ request, locals }) => {
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
		const userBelongsToGroup = toGroupId && (await isUserInGroup(fromUserId, toGroupId));
		if (!userBelongsToGroup) {
			return fail(403, {
				errors: 'Cannot send invitation for a group to which you do not belong.'
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
		// TODO sendEmail(toEmail, template, props);
		return { success: true, data: { invitation } };
	}
};
