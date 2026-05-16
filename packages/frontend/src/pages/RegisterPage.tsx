import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useRegister } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthAtmospherePanel } from '@/components/auth/AuthAtmospherePanel';
import { ApiError } from '@/lib/api';

const schema = z.object({
  username: z.string().min(3, '3-30 characters').max(30, '3-30 characters'),
  password: z.string().min(8, 'Minimum 8 characters'),
});

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await register.mutateAsync(values);
      navigate('/');
    } catch {
      // surfaced below
    }
  });

  const errorMessage =
    register.error instanceof ApiError && register.error.status === 409
      ? 'Username already taken'
      : register.error
        ? 'Registration failed. Try again.'
        : null;

  return (
    <main className="grid min-h-screen bg-bg text-text lg:grid-cols-[3fr_2fr]">
      <AuthAtmospherePanel />
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-[-0.02em] text-text-strong">Create account</h1>
            <p className="text-xs text-muted">First registrant becomes admin.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="username" className="text-xs uppercase tracking-[0.14em] text-muted">
                Username
              </Label>
              <Input
                id="username"
                autoComplete="username"
                className="font-mono"
                {...form.register('username')}
              />
              {form.formState.errors.username && (
                <p className="text-xs text-loss">{form.formState.errors.username.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="password" className="text-xs uppercase tracking-[0.14em] text-muted">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                className="font-mono"
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-loss">{form.formState.errors.password.message}</p>
              )}
            </div>
            {errorMessage && <p className="text-sm text-loss">{errorMessage}</p>}
            <Button
              type="submit"
              className="w-full font-mono uppercase tracking-[0.1em]"
              disabled={register.isPending}
            >
              {register.isPending ? 'Creating…' : 'Create account'}
            </Button>
          </form>
          <p className="text-xs text-muted">
            Already have an account?{' '}
            <Link to="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
