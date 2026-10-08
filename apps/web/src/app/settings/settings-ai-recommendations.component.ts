import {
    ChangeDetectionStrategy,
    Component,
    input,
    signal,
    OnInit,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-settings-ai-recommendations',
    imports: [
        ReactiveFormsModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatInputModule,
        TranslateModule,
    ],
    templateUrl: './settings-ai-recommendations.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsAiRecommendationsComponent implements OnInit {
    readonly form = input.required<FormGroup>();
    readonly tokenAvailable = signal<boolean | null>(null);

    async ngOnInit(): Promise<void> {
        try {
            const status =
                await window.electron?.getAiRecommendationsStatus?.();
            this.tokenAvailable.set(status?.available === true);
        } catch {
            this.tokenAvailable.set(false);
        }
    }
}
