import {
    ChangeDetectionStrategy,
    Component,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MAX_WATCH_INTENT_LENGTH } from './dashboard-watch-intent';

@Component({
    selector: 'lib-dashboard-watch-assistant',
    imports: [MatIcon, RouterLink, TranslatePipe],
    templateUrl: './dashboard-watch-assistant.component.html',
    styleUrl: './dashboard-watch-assistant.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardWatchAssistantComponent {
    readonly busy = input(false);
    readonly enabled = input(true);
    readonly intent = input('');
    readonly intentChange = output<string>();
    readonly draft = signal('');
    readonly maxLength = MAX_WATCH_INTENT_LENGTH;
    readonly suggestions = ['MYSTERY', 'UPLIFTING', 'SCIFI'];
    private readonly translate = inject(TranslateService);

    constructor() {
        effect(() => this.draft.set(this.intent()));
    }

    submit(event: Event): void {
        event.preventDefault();
        const request = this.draft().trim().slice(0, this.maxLength);
        if (!this.busy() && request) this.intentChange.emit(request);
    }

    suggest(key: string): void {
        if (this.busy()) return;
        this.intentChange.emit(
            this.translate.instant(`WORKSPACE.DASHBOARD.ASSISTANT_${key}`)
        );
    }
}
