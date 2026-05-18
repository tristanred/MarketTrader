import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useAdminUser,
  useAdminUpdateUser,
  useAdminDeleteUser,
  useAdminResetPassword,
  useAdminAddUserGroup,
  useAdminRemoveUserGroup,
} from '@/api/admin/users';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { toastApiError } from '@/lib/toastApiError';

const editSchema = z.object({
  username: z.string().min(3).max(30),
  disabled: z.boolean(),
});
type EditValues = z.infer<typeof editSchema>;

const passwordSchema = z.object({
  newPassword: z.string().min(8, 'Min 8 characters'),
});
type PasswordValues = z.infer<typeof passwordSchema>;

export function AdminUserDetailPage() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.user);
  const isSelf = me?.id === userId;

  const { data: user, isLoading, isError } = useAdminUser(userId);
  const updateUser = useAdminUpdateUser(userId);
  const deleteUser = useAdminDeleteUser(userId);
  const resetPassword = useAdminResetPassword(userId);
  const addGroup = useAdminAddUserGroup(userId);
  const removeGroup = useAdminRemoveUserGroup(userId);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteForce, setDeleteForce] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { username: '', disabled: false },
  });
  useEffect(() => {
    if (user) editForm.reset({ username: user.username, disabled: user.disabled });
    // Re-sync on every refetch (not just when the id changes) so an
    // out-of-band update to the same user lands in the form.
  }, [user, editForm]);
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { newPassword: '' },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (isError || !user) {
    return <p className="text-sm text-destructive">User not found.</p>;
  }

  const isAdminGroup = user.groups.includes('admin');

  const submitEdit = editForm.handleSubmit(async (values) => {
    try {
      await updateUser.mutateAsync(values);
      toast({ title: 'User updated', variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Update failed');
    }
  });

  const submitPassword = passwordForm.handleSubmit(async (values) => {
    try {
      await resetPassword.mutateAsync(values);
      toast({ title: 'Password reset', variant: 'success' });
      passwordForm.reset();
      setShowPassword(false);
    } catch (err) {
      toastApiError(err, 'Reset failed');
    }
  });

  async function toggleAdminGroup() {
    try {
      if (isAdminGroup) {
        await removeGroup.mutateAsync('admin');
        toast({ title: 'Removed from admin', variant: 'success' });
      } else {
        await addGroup.mutateAsync('admin');
        toast({ title: 'Granted admin', variant: 'success' });
      }
    } catch (err) {
      toastApiError(err, 'Group change failed');
    }
  }

  async function onConfirmDelete() {
    try {
      await deleteUser.mutateAsync({ force: deleteForce });
      toast({ title: 'User deleted', variant: 'success' });
      navigate('/admin/users');
    } catch (err) {
      toastApiError(err, 'Delete failed');
      setShowDelete(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin/users" className="text-sm text-muted-foreground hover:underline">
            ← All users
          </Link>
          <h1 className="text-2xl font-semibold">{user.username}</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Games played</div>
            <div className="text-lg font-medium">{user.gamesPlayed}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Games owned</div>
            <div className="text-lg font-medium">{user.gamesOwned}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Trades</div>
            <div className="text-lg font-medium">{user.tradeCount}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitEdit} className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input id="username" {...editForm.register('username')} />
              {editForm.formState.errors.username && (
                <p className="mt-1 text-xs text-destructive">
                  {editForm.formState.errors.username.message}
                </p>
              )}
            </div>
            {!isSelf && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...editForm.register('disabled')} />
                <span>Account disabled</span>
              </label>
            )}
            <Button type="submit" disabled={updateUser.isPending}>
              {updateUser.isPending ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Groups</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm">
          <span>admin</span>
          {!isSelf && (
            <Button
              variant={isAdminGroup ? 'outline' : 'default'}
              size="sm"
              onClick={toggleAdminGroup}
              disabled={addGroup.isPending || removeGroup.isPending}
            >
              {isAdminGroup ? 'Remove' : 'Grant'}
            </Button>
          )}
          {isSelf && isAdminGroup && (
            <span className="text-xs text-muted-foreground">(cannot remove yourself)</span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reset password</CardTitle>
        </CardHeader>
        <CardContent>
          {showPassword ? (
            <form onSubmit={submitPassword} className="space-y-3">
              <div>
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  {...passwordForm.register('newPassword')}
                />
                {passwordForm.formState.errors.newPassword && (
                  <p className="mt-1 text-xs text-destructive">
                    {passwordForm.formState.errors.newPassword.message}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={resetPassword.isPending}>
                  {resetPassword.isPending ? 'Resetting…' : 'Reset'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowPassword(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" onClick={() => setShowPassword(true)}>
              Reset password…
            </Button>
          )}
        </CardContent>
      </Card>

      {!isSelf && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setShowDelete(true)}>
              Delete user
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title={`Delete ${user.username}?`}
        description="This cascades to their players and trades. Games they own cannot be deleted this way — transfer ownership first."
        confirmLabel="Delete"
        destructive
        toggle={{
          label: 'Force (also delete if they have players)',
          value: deleteForce,
          onChange: setDeleteForce,
        }}
        onConfirm={onConfirmDelete}
      />
    </div>
  );
}
