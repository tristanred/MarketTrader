CREATE INDEX "trades_status_idx" ON "trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trades_player_status_idx" ON "trades" USING btree ("game_player_id","status");