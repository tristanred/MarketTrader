import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateGame } from '@/api/games';
import { toast } from '@/components/ui/toast';

const schema = z
  .object({
    name: z.string().min(1, 'Required').max(100),
    startDate: z.string().min(1, 'Required'),
    endDate: z.string().min(1, 'Required'),
    startingBalance: z.coerce.number().positive('Must be > 0'),
    allowShortSelling: z.boolean(),
  })
  .refine((d) => new Date(d.endDate) > new Date(d.startDate), {
    message: 'End must be after start',
    path: ['endDate'],
  });

type FormValues = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

function toIsoOrEmpty(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

export function CreateGameDialog() {
  const [open, setOpen] = useState(false);
  const createGame = useCreateGame();

  const defaults: FormValues = {
    name: '',
    startDate: '',
    endDate: '',
    startingBalance: 100000,
    allowShortSelling: false,
  };

  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createGame.mutateAsync({
        name: values.name,
        startDate: toIsoOrEmpty(values.startDate),
        endDate: toIsoOrEmpty(values.endDate),
        startingBalance: values.startingBalance,
        allowShortSelling: values.allowShortSelling,
      });
      toast({ title: 'Game created', variant: 'success' });
      setOpen(false);
      form.reset(defaults);
    } catch {
      toast({ title: 'Failed to create game', variant: 'destructive' });
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create game</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New game</DialogTitle>
          <DialogDescription>
            Set up a virtual trading tournament. Players start with the same balance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="startDate">Start</Label>
              <Input id="startDate" type="datetime-local" {...form.register('startDate')} />
              {form.formState.errors.startDate && (
                <p className="text-xs text-destructive">{form.formState.errors.startDate.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="endDate">End</Label>
              <Input id="endDate" type="datetime-local" {...form.register('endDate')} />
              {form.formState.errors.endDate && (
                <p className="text-xs text-destructive">{form.formState.errors.endDate.message}</p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="startingBalance">Starting balance ($)</Label>
            <Input
              id="startingBalance"
              type="number"
              step="any"
              min="0.01"
              {...form.register('startingBalance')}
            />
            {form.formState.errors.startingBalance && (
              <p className="text-xs text-destructive">
                {form.formState.errors.startingBalance.message}
              </p>
            )}
          </div>
          <div className="flex items-start gap-2">
            <input
              id="allowShortSelling"
              type="checkbox"
              className="mt-1 h-4 w-4"
              {...form.register('allowShortSelling')}
            />
            <div className="space-y-0.5">
              <Label htmlFor="allowShortSelling" className="cursor-pointer">
                Allow short selling
              </Label>
              <p className="text-xs text-muted-foreground">
                When enabled, players can SELL SHORT and BUY TO COVER. Leave off for a long-only game.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createGame.isPending}>
              {createGame.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
