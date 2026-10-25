import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DashboardWatchAssistantComponent } from './dashboard-watch-assistant.component';
import { dashboardWatchIntentSettings } from './dashboard-watch-intent';

describe('DashboardWatchAssistantComponent', () => {
    const create = async () => {
        await TestBed.configureTestingModule({
            imports: [
                DashboardWatchAssistantComponent,
                TranslateModule.forRoot(),
            ],
            providers: [provideRouter([])],
        }).compileComponents();
        TestBed.inject(TranslateService).setTranslation('en', {
            WORKSPACE: { DASHBOARD: { ASSISTANT_MYSTERY: 'A clever mystery' } },
        });
        TestBed.inject(TranslateService).use('en');
        const fixture = TestBed.createComponent(
            DashboardWatchAssistantComponent
        );
        fixture.detectChanges();
        return fixture;
    };

    it('keeps typing local until an explicit submission and trims the request', async () => {
        const fixture = await create();
        const emit = jest.spyOn(fixture.componentInstance.intentChange, 'emit');
        const textarea = fixture.nativeElement.querySelector(
            'textarea'
        ) as HTMLTextAreaElement;
        textarea.value = '  A quiet mystery  ';
        textarea.dispatchEvent(new Event('input'));
        fixture.detectChanges();
        expect(emit).not.toHaveBeenCalled();
        fixture.nativeElement
            .querySelector('form')
            .dispatchEvent(new Event('submit', { cancelable: true }));
        expect(emit).toHaveBeenCalledWith('A quiet mystery');
    });

    it('submits localized suggestions, blocks busy or blank submits, and allows clearing while busy', async () => {
        const fixture = await create();
        const component = fixture.componentInstance;
        const emit = jest.spyOn(component.intentChange, 'emit');
        component.suggest('MYSTERY');
        expect(emit).toHaveBeenLastCalledWith('A clever mystery');
        emit.mockClear();
        component.submit(new Event('submit'));
        expect(emit).not.toHaveBeenCalled();
        fixture.componentRef.setInput('intent', 'A clever mystery');
        fixture.componentRef.setInput('busy', true);
        fixture.detectChanges();
        component.submit(new Event('submit'));
        component.suggest('MYSTERY');
        expect(emit).not.toHaveBeenCalled();
        fixture.nativeElement
            .querySelector('[data-test-id="dashboard-watch-clear"]')
            .click();
        expect(emit).toHaveBeenCalledWith('');
        fixture.componentRef.setInput('intent', '');
        fixture.detectChanges();
        expect(component.draft()).toBe('');
    });

    it('offers the real settings route without a composer while AI is disabled', async () => {
        const fixture = await create();
        fixture.componentRef.setInput('enabled', false);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
        expect(
            fixture.nativeElement.querySelector('a').getAttribute('href')
        ).toBe('/workspace/settings/dashboard');
    });
});

describe('dashboardWatchIntentSettings', () => {
    const saved = {
        enabled: true,
        learnFromHistory: false,
        model: 'security',
        preferences: 'Slow stories',
    };

    it('preserves saved preferences and independent consent, including when clearing', () => {
        const request = dashboardWatchIntentSettings(
            saved,
            '  A comedy tonight  '
        );
        expect(request).toEqual({
            ...saved,
            preferences:
                'Slow stories\n\nCurrent watch request (prioritize for this session): A comedy tonight',
        });
        expect(saved.preferences).toBe('Slow stories');
        expect(dashboardWatchIntentSettings(saved, ' ')).toEqual(saved);
        expect(
            dashboardWatchIntentSettings({ ...saved, enabled: false }, 'Comedy')
                .enabled
        ).toBe(false);
    });

    it('bounds preferences at the IPC limit while retaining the complete bounded request', () => {
        const config = dashboardWatchIntentSettings(
            { ...saved, preferences: 'a'.repeat(2000) },
            'b'.repeat(600)
        );
        expect(config.preferences.length).toBe(2000);
        expect(config.preferences.endsWith('b'.repeat(500))).toBe(true);
    });
});
